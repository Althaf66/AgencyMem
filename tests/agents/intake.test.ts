// Task 2.5, Done when (end to end): fixture set A uploaded, the real Intake agent loop over the real
// gateway and FalkorDB, with the model replaced by the recorded replies in tests/recordings.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope, type ProjectInfo } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { createModelClient, loadRecording, replayChat } from "@agencymem/llm";
import { createEvents } from "../../apps/gateway/src/events/bus";
import { createGateway } from "../../apps/gateway/src/main";
import { intake } from "../../apps/runner/src/agents/intake/agent";
import { runLoop } from "../../apps/runner/src/loop";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../../apps/simulator/fixtures/A");
const SET_A = ["kickoff-notes.pdf", "client-summary.docx", "whatsapp-chat.txt"];
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
// Built at run time, so this file holds no Cypher string literal (AGENTS.md rule 4).
const q = (...parts: string[]) => parts.join(" ");

let db: FalkorDB;
let server: Server;
let base: string;
const events = createEvents();
const graphs = new Set<string>();

beforeAll(async () => {
  db = await connect(FALKORDB_URL);
  server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), { events });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  for (const graph of graphs) await db.selectGraph(graph).delete();
  await close();
});

const ui = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };

async function rows(projectId: string, cypher: string): Promise<unknown[][]> {
  const res = await fetch(`${base}/api/query`, {
    method: "POST",
    headers: { ...ui, "Content-Type": "application/json", "X-AM-Project": projectId },
    body: JSON.stringify({ graph: "client", cypher }),
  });
  return ((await res.json()) as { rows: unknown[][] }).rows;
}

describe("Done when: every fact has a SOURCED_FROM edge (set A through the Intake agent)", () => {
  it("turns the three notes into sourced facts, then T3 opens discovery", async () => {
    const created = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { ...ui, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: `test-client-${randomUUID()}`,
        projectName: "Clinic booking",
        mode: "demo",
      }),
    });
    const { project } = (await created.json()) as { project: ProjectInfo };
    graphs.add(`client_${project.clientId}`);

    const form = new FormData();
    for (const name of SET_A) {
      form.append("files", new Blob([await readFile(join(FIXTURES, name))]), name);
    }
    await fetch(`${base}/api/projects/${project.id}/files`, {
      method: "POST",
      headers: ui,
      body: form,
    });

    // Three items, each ends with a "Done" step; complete_item has run T3 before that step.
    let off = () => {};
    const done = new Promise<void>((resolve) => {
      let count = 0;
      off = events.on((e: Envelope) => {
        if (e.projectId !== project.id || e.type !== "run.step") return;
        if (e.data.text === "Done" && ++count === SET_A.length) resolve();
      });
    });
    const replies = await loadRecording(join(HERE, "../recordings/intake-A.json"));
    const stop = new AbortController();
    const loop = runLoop(intake, {
      gatewayUrl: base,
      token: "agent-t",
      llm: createModelClient({ chat: replayChat(replies), prices: {} }),
      heartbeatMs: 60_000,
      idleMs: 20,
      projects: async () => [project.id], // other test files share the database
      signal: stop.signal,
    });
    await Promise.race([
      done,
      loop.then(() => {
        throw new Error("runLoop ended before the three items were done");
      }),
    ]);
    off();
    stop.abort();
    await loop;

    // Every fact has at least one SOURCED_FROM edge, and none is missing.
    const facts = await rows(
      project.id,
      q(
        "MATCH",
        "(f:Fact)",
        "OPTIONAL MATCH",
        "(f)-[:SOURCED_FROM]->(e:Episode)-[:PART_OF]->(d:Document)",
        "RETURN",
        "f.id, count(e), collect(DISTINCT d.name)",
      ),
    );
    expect(facts).toHaveLength(24 + 18 + 6);
    for (const [, sources, documents] of facts as [string, number, string[]][]) {
      expect(sources).toBeGreaterThanOrEqual(1);
      expect(documents).toHaveLength(1); // a fact cites episodes of its own document
    }

    // One Entity per key across the three documents; the items are done with their handoffs.
    expect(
      await rows(project.id, q("MATCH", "(n:Entity {key: 'clinic'})", "RETURN", "count(n)")),
    ).toEqual([[1]]);
    expect(
      await rows(
        project.id,
        q("MATCH", "(w:WorkItem)", "RETURN", "w.kind, w.status, w.handoff ORDER BY w.handoff"),
      ),
    ).toEqual([
      ["intake", "done", "18 facts from client-summary.docx"],
      ["intake", "done", "24 facts from kickoff-notes.pdf"],
      ["intake", "done", "6 facts from whatsapp-chat.txt"],
      ["discovery", "open", null],
    ]);
    const info = await fetch(`${base}/api/projects/${project.id}`, { headers: ui });
    expect(((await info.json()) as { project: ProjectInfo }).project.stage).toBe("discovery");
  });
});
