// One block per guard: its rejection case, an allowed case, and the rejection counted on the real
// Project in the registry (FalkorDB from docker-compose.yml). Guard logic is pure, so its inputs are
// fixtures (technical design "Unit: guards"); the counting is a real write.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RejectionCounter } from "@agencymem/contracts";
import { REGISTRY_GRAPH, close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import { createProject } from "@agencymem/memory";
import {
  CLAIMS,
  OWNS,
  anonymity,
  deps,
  evidence,
  gate,
  lease,
  leaseHeld,
  ownership,
  readOnly,
  rejectAndCount,
  runGuards,
  source,
  tenancy,
  version,
  type GuardResult,
} from "./index";

const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const P = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const OTHER = "01ARZ3NDEKTSV4RRFFQ69G5FAW";
const COUNTERS: RejectionCounter[] = [
  "rejectedWrites",
  "rejectedClaims",
  "rejectedCompletions",
  "rejectedQueries",
];
let db: FalkorDB;
let projectId: string;
let clientGraph: string;

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Guards",
    mode: "demo",
    createdBy: "human:test",
    now: 1,
  });
  projectId = project.id;
  clientGraph = `client_${client.id}`;
});
afterAll(async () => {
  await db.selectGraph(clientGraph).delete();
  await close();
});

async function counters(): Promise<Record<RejectionCounter, number>> {
  const [row] = await readQuery<{ p: { properties: Record<RejectionCounter, number> } }>(
    db,
    REGISTRY_GRAPH,
    "read/project",
    { projectId },
  );
  return row!.p.properties;
}

/** Rejects through rejectAndCount and checks that exactly `counter` went up by 1 (or none). */
async function expectCounted(result: GuardResult | null, counter: RejectionCounter | null) {
  expect(result).not.toBeNull();
  const before = await counters();
  const rejection = await rejectAndCount(db, projectId, result!);
  expect(rejection).toMatchObject({
    code: "GUARD_REJECTED",
    guard: result!.guard,
    details: { reasonCode: result!.reasonCode },
  });
  const after = await counters();
  for (const c of COUNTERS) expect(after[c] - before[c]).toBe(c === counter ? 1 : 0);
}

const intake = { kind: "agent", agent: "intake" } as const;

describe("tenancy", () => {
  it("rejects a missing or unknown project, and a node of another project", async () => {
    expect(tenancy({ projectId: undefined, known: false })?.reasonCode).toBe("PROJECT_MISSING");
    expect(tenancy({ projectId: P, known: false })?.reasonCode).toBe("PROJECT_UNKNOWN");
    const foreign = tenancy({
      projectId: P,
      known: true,
      nodes: [
        { id: "a", projectId: P },
        { id: "b", projectId: OTHER },
      ],
    });
    expect(foreign).toMatchObject({ reasonCode: "FOREIGN_NODE", details: { nodeId: "b" } });
    expect(tenancy({ projectId: P, known: true, nodes: [{ id: "a", projectId: P }] })).toBeNull();
    await expectCounted(foreign, "rejectedWrites");
  });
});

describe("ownership", () => {
  it("rejects a label the agent does not own, and an item kind it does not claim", async () => {
    const label = ownership(intake, "write_question");
    expect(label).toMatchObject({ reasonCode: "LABEL_NOT_OWNED", details: { label: "Question" } });
    expect(ownership(intake, "write_fact", { itemKind: "intake" })).toBeNull();

    const kind = ownership(intake, "write_fact", { itemKind: "discovery" });
    expect(kind).toMatchObject({
      reasonCode: "ITEM_KIND_NOT_OWNED",
      details: { kind: "discovery" },
    });
    expect(ownership(intake, "write_fact", { itemKind: "intake_answer" })).toBeNull();

    // C8: only launch may write a ReadinessReport through write_handoff.
    const report = ownership(intake, "write_handoff", { labels: ["ReadinessReport"] });
    expect(report).toMatchObject({ reasonCode: "LABEL_NOT_OWNED" });
    expect(
      ownership({ kind: "agent", agent: "launch" }, "write_handoff", {
        itemKind: "launch",
        labels: ["ReadinessReport"],
      }),
    ).toBeNull();
    await expectCounted(label, "rejectedWrites");
  });

  it("rejects a tool used on an item kind the tool is not for, even with owned labels", async () => {
    // intake owns Fact, but record_change_request is for change_request items (proposal).
    const crByIntake = ownership(intake, "record_change_request", { itemKind: "intake" });
    expect(crByIntake).toMatchObject({
      reasonCode: "ITEM_KIND_NOT_OWNED",
      details: { kind: "intake" },
    });
    // planner owns Task, but propose_fix is for maintenance items.
    const planner = { kind: "agent", agent: "planner" } as const;
    expect(ownership(planner, "propose_fix", { itemKind: "planner" })?.reasonCode).toBe(
      "ITEM_KIND_NOT_OWNED",
    );
    // A tool pinned to item kinds needs the item's kind.
    expect(ownership(intake, "write_fact")?.reasonCode).toBe("ITEM_KIND_NOT_OWNED");
    const proposal = { kind: "agent", agent: "proposal" } as const;
    expect(ownership(proposal, "record_change_request", { itemKind: "change_request" })).toBeNull();
    await expectCounted(crByIntake, "rejectedWrites");
  });

  it("lets a UI session call only read_query", async () => {
    const ui = { kind: "ui" } as const;
    const refused = ownership(ui, "claim_item");
    expect(refused).toMatchObject({
      reasonCode: "LABEL_NOT_OWNED",
      details: { tool: "claim_item" },
    });
    expect(ownership(ui, "read_query")).toBeNull();
    await expectCounted(refused, "rejectedWrites");
  });

  it("follows the ownership table of the technical design", () => {
    expect(OWNS.build).toEqual([]);
    expect(OWNS.curator).toEqual(["CaseStudy", "Lesson", "EstimateRecord"]);
    expect(CLAIMS.build).toEqual(["merge"]);
    expect(CLAIMS.test).toEqual(["write_tests", "test_run", "e2e"]);
  });
});

describe("gate", () => {
  it("rejects when the gate before the stage is not approved", async () => {
    const waiting = gate("G1", { status: "waiting" });
    expect(waiting).toMatchObject({
      reasonCode: "GATE_NOT_APPROVED",
      details: { gateKey: "G1", status: "waiting" },
    });
    expect(gate("G2", null)).toMatchObject({ details: { gateKey: "G2", status: null } });
    expect(gate("G1", { status: "approved" })).toBeNull();
    await expectCounted(waiting, "rejectedWrites");
  });
});

describe("source", () => {
  it("rejects an element with no source, or a source that does not exist", async () => {
    const known = new Set(["e1", "e2"]);
    expect(source([{ ids: ["e1"] }, { ids: [] }], known)).toMatchObject({
      reasonCode: "SOURCE_MISSING",
      details: { index: 1 },
    });
    const unknown = source([{ ids: ["e1", "e9"] }], known);
    expect(unknown).toMatchObject({ reasonCode: "SOURCE_UNKNOWN", details: { index: 0 } });
    expect(source([{ ids: ["e1"] }, { ids: ["e2"] }], known)).toBeNull();
    await expectCounted(unknown, "rejectedWrites");
  });
});

describe("version", () => {
  it("rejects a version that is not the current one", async () => {
    const old = version(2, 3);
    expect(old).toMatchObject({ reasonCode: "VERSION_OLD", details: { current: 3, sent: 2 } });
    expect(version(3, 3)).toBeNull();
    await expectCounted(old, "rejectedWrites");
  });
});

describe("lease", () => {
  it("rejects an ended lease or another worker's lease (a rejected write)", async () => {
    const other = lease({ owner: "intake-2", until: 100 }, "intake-1", 50);
    expect(other).toMatchObject({
      reasonCode: "LEASE_OTHER_WORKER",
      details: { owner: "intake-2", until: 100 },
    });
    expect(lease({ owner: "intake-1", until: 100 }, "intake-1", 101)?.reasonCode).toBe(
      "LEASE_ENDED",
    );
    expect(lease({ owner: null, until: null }, "intake-1", 1)?.reasonCode).toBe("LEASE_ENDED");
    expect(lease({ owner: "intake-1", until: 100 }, "intake-1", 100)).toBeNull();
    await expectCounted(other, "rejectedWrites");
  });

  it("rejects a claim on a held item (a rejected claim)", async () => {
    const held = leaseHeld({ owner: "intake-2", until: 100 });
    expect(held).toMatchObject({
      reasonCode: "LEASE_HELD",
      details: { owner: "intake-2", until: 100 },
    });
    await expectCounted(held, "rejectedClaims");
  });
});

describe("evidence", () => {
  const base = { sha: "a".repeat(40), cases: 2, passing: 2, failing: [], runPending: false };

  it("rejects no commit, no tests and a failing run (rejected completions)", async () => {
    expect(evidence({ ...base, sha: null })?.reasonCode).toBe("NO_COMMIT");
    expect(evidence({ ...base, cases: 0, passing: 0 })?.reasonCode).toBe("NO_TESTS");
    const failed = evidence({ ...base, passing: 1, failing: ["AC-01-2"] });
    expect(failed).toMatchObject({
      reasonCode: "RUN_FAILED",
      details: { sha: base.sha, cases: 2, passing: 1, failing: ["AC-01-2"] },
    });
    expect(evidence(base)).toBeNull();
    await expectCounted(failed, "rejectedCompletions");
  });

  it("answers RUN_PENDING while the run is going, and does not count it", async () => {
    const pending = evidence({ ...base, passing: 0, runPending: true });
    expect(pending).toMatchObject({ reasonCode: "RUN_PENDING", details: { retryAfterMs: 30000 } });
    await expectCounted(pending, null);
  });
});

describe("deps", () => {
  it("rejects a card whose dependencies are not Done", async () => {
    const open = deps(["CARD-01", "CARD-03"]);
    expect(open).toMatchObject({
      reasonCode: "DEPS_OPEN",
      details: { openKeys: ["CARD-01", "CARD-03"] },
    });
    expect(deps([])).toBeNull();
    await expectCounted(open, "rejectedClaims");
  });
});

describe("read-only", () => {
  // Built at run time, so this test file holds no Cypher string literal (AGENTS.md rule 4).
  const q = (...parts: string[]) => parts.join(" ");

  it("rejects any write clause, outside comments and strings", async () => {
    const write = readOnly(q("MATCH", "(n)", "DETACH", "DELETE", "n"), "ui");
    expect(write).toMatchObject({ reasonCode: "WRITE_CLAUSE", details: { clause: "DELETE" } });
    for (const [cypher, clause] of [
      [q("create", "(n:X)"), "CREATE"],
      [q("MATCH", "(n)", "SET", "n.a = 1"), "SET"],
      [q("MERGE", "(n:X {id: 1})"), "MERGE"],
      [q("MATCH", "(n)", "REMOVE", "n.a"), "REMOVE"],
      [q("DROP", "INDEX ON :X(id)"), "DROP"],
      [q("LOAD", "CSV FROM 'x' AS row", "RETURN", "row"), "LOAD CSV"],
      [q("CALL", "db.idx.fulltext.drop('X')"), q("CALL", "db.")],
    ]) {
      expect(readOnly(cypher!, "ui")?.details).toMatchObject({ clause });
    }
    const inStrings = q("MATCH", "(n {name: 'CREATE'}) // SET\n", "RETURN", "n /* DELETE */");
    expect(readOnly(inStrings, "ui")).toBeNull();
    const words = q("MATCH", '(n) WHERE n.note = "set it"', "RETURN", "n.offset");
    expect(readOnly(words, "ui")).toBeNull();
    // A quote inside a backtick identifier must not open a string that hides a real clause.
    const hiddenCreate = q("MATCH", "(n:`a'b`)", "CREATE", "(m)", "RETURN", "'`'");
    expect(readOnly(hiddenCreate, "ui")?.details).toMatchObject({ clause: "CREATE" });
    const hiddenLoad = q(
      "MATCH",
      "(n:`x'`)",
      "LOAD",
      "CSV FROM 'file:///x' AS r",
      "RETURN",
      "r, '`'",
    );
    expect(readOnly(hiddenLoad, "ui")?.details).toMatchObject({ clause: "LOAD CSV" });
    await expectCounted(write, "rejectedQueries");
  });

  it("rejects a session that is not the UI session", async () => {
    const agent = readOnly(q("MATCH", "(n)", "RETURN", "n"), "agent");
    expect(agent?.reasonCode).toBe("NOT_UI_SESSION");
    await expectCounted(agent, "rejectedQueries");
  });
});

describe("anonymity", () => {
  it("rejects a known client name, an email or a URL in lesson text", async () => {
    const names = ["Sunrise Dental", "Dr. Okafor"];
    const name = anonymity(["Forms at sunrise dental ran long."], names);
    expect(name).toMatchObject({ reasonCode: "NAME_FOUND", details: { match: "Sunrise Dental" } });
    expect(anonymity(["Mail ana@example.org"], names)?.reasonCode).toBe("EMAIL_FOUND");
    expect(anonymity(["See https://example.org/x"], names)?.reasonCode).toBe("URL_FOUND");
    expect(anonymity(["Forms ran 1.5x the raw estimate."], names)).toBeNull();
    await expectCounted(name, "rejectedWrites");
  });
});

describe("runGuards", () => {
  it("runs guards in the documented order, whatever order they are given, and stops at the first rejection", async () => {
    const ran: string[] = [];
    const reject = (g: GuardResult) => () => {
      ran.push(g.guard);
      return g;
    };
    const pass = (name: string) => () => {
      ran.push(name);
      return null;
    };
    const result = await runGuards([
      { guard: "lease", check: pass("lease") },
      { guard: "version", check: reject(version(1, 2)!) },
      { guard: "tenancy", check: pass("tenancy") },
      { guard: "ownership", check: pass("ownership") },
    ]);
    expect(ran).toEqual(["tenancy", "ownership", "version"]);
    expect(result?.reasonCode).toBe("VERSION_OLD");
    expect(await runGuards([{ guard: "tenancy", check: pass("t") }])).toBeNull();
  });
});
