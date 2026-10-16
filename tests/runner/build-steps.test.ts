// Task 4.6, Done when: the board shows the steps under the card as they happen. A build run (the
// fake OpenCode of opencode.test.ts) through runOpenCode and forwardEvents, posted to the real
// gateway against the real FalkorDB: the run.step events the board draws arrive under the card's
// id, in order, and the final step writes the run's Run node. It lives outside apps/, because the
// runner may not import the gateway (AGENTS.md rule 1).
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope } from "@agencymem/contracts";
import { close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  createProject,
  deleteTestClient,
  writeCards,
  writeDocument,
  writeFacts,
  writeProduct,
} from "@agencymem/memory";
import { createEvents } from "../../apps/gateway/src/events/bus";
import { createGateway } from "../../apps/gateway/src/main";
import { openSession } from "../../apps/runner/src/mcp-client";
import { runOpenCode } from "../../apps/runner/src/opencode";
import { finalStep, forwardEvents } from "../../apps/runner/src/opencode-events";

const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const FAKE = fileURLToPath(new URL("../../apps/runner/src/opencode.fake.mjs", import.meta.url));

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
  for (const graph of graphs) await deleteTestClient(db, graph);
  await close();
});

/** A project with one card, CARD-01. */
async function oneCard(): Promise<{ projectId: string; graph: string; taskId: string }> {
  const now = Date.now();
  const { project, client } = await createProject(db, {
    clientName: `test-client-${randomUUID()}`,
    projectName: "Build steps",
    mode: "demo",
    createdBy: "human:test",
    now,
  });
  const ctx = { db, graph: `client_${client.id}`, projectId: project.id };
  graphs.add(ctx.graph);
  const { episodeIds } = await writeDocument(ctx, {
    name: "notes.pdf",
    mime: "application/pdf",
    sha256: "d".repeat(64),
    status: "processed",
    wordCount: 5,
    error: null,
    episodes: [{ page: 1, lineStart: 1, lineEnd: 1, text: "One rule." }],
    createdBy: "human:test",
    now,
  });
  const { factIds } = await writeFacts(ctx, {
    entities: [{ key: "clinic", name: "Clinic", aliases: [] }],
    facts: [
      {
        statement: "Rule 1 is A.",
        subject: "clinic",
        attribute: "rule_1",
        value: "A",
        episodeIds,
        replacesFactId: null,
      },
    ],
    createdBy: "intake",
    now,
  });
  await writeProduct(ctx, {
    baseVersion: 0,
    requirements: [{ key: "REQ-01", text: "A patient can book.", priority: "must", factIds }],
    features: [
      {
        key: "FEAT-01",
        name: "Booking",
        featureKind: "form",
        requirementKeys: ["REQ-01"],
        estimate: { rawHours: 4, hours: 4, basis: "raw 4 h, no lesson = 4 h", lessonIds: [] },
      },
    ],
    createdBy: "proposal",
    now,
  });
  const { taskIds } = (await writeCards(ctx, {
    cards: [
      {
        key: "CARD-01",
        title: "Card 1",
        description: "Builds part 1.",
        lane: "Backend",
        order: 10,
        requirementKey: "REQ-01",
        designKeys: [],
        dependsOn: [],
        criteria: [{ key: "AC-01-1", text: "Given 1, when it runs, then it works.", testIds: [] }],
      },
    ] as never,
    createdBy: "planner",
    now,
  }))!;
  return { projectId: project.id, graph: ctx.graph, taskId: taskIds[0]! };
}

describe("Done when: the board shows the steps under the card as they happen", () => {
  it("sends each mapped OpenCode event as a run.step of the card, then the final step with its Run", async () => {
    const { projectId, graph, taskId } = await oneCard();
    const session = await openSession(
      { gatewayUrl: base, token: "agent-t" },
      { agent: "build", projectId, workerId: "build-1" },
    );
    const sent: Envelope[] = [];
    const off = events.on(
      (e) => e.projectId === projectId && e.type === "run.step" && sent.push(e),
    );
    process.env.FAKE_OC = "ok";
    const forward = forwardEvents(session.step, taskId, "/ws/wt/CARD-01");
    try {
      const model = "fallback/vendor/model-y";
      const result = await runOpenCode({
        bin: [process.execPath, FAKE],
        tree: "/ws/wt/CARD-01",
        cardKey: "CARD-01",
        model,
        env: {
          AM_PROJECT_ID: projectId,
          AM_WORKER_ID: "build-1",
          GATEWAY_URL: base,
          AM_HOOK_TOKEN: "hook-t",
          PORT: "5181",
        },
        heartbeat: async () => {},
        heartbeatMs: 60_000,
        onEvent: forward.onEvent,
      });
      await forward.drain();
      await session.step(finalStep(taskId, result, model));
    } finally {
      delete process.env.FAKE_OC;
      off();
      await session.close();
    }

    // Every step is the card's, in the order OpenCode did the work, and the final step comes last.
    expect(sent.map((e) => (e.data as { itemId: string }).itemId)).toEqual([
      taskId,
      taskId,
      taskId,
    ]);
    expect(sent.map((e) => (e.data as { text: string }).text).slice(0, 2)).toEqual([
      "Called get_task_context",
      "Ran npm test",
    ]);
    expect(sent[2]!.data).toMatchObject({
      agent: "build",
      step: "exit",
      text: expect.stringMatching(/^Run finished \(exit 0, \d+ s\)$/),
      model: "vendor/model-y",
      tokens: 19,
    });

    const runs = await readQuery<{ step: string; agent: string; endpoint: string }>(
      db,
      graph,
      "read/item-runs",
      { itemId: taskId },
    );
    expect(runs).toMatchObject([{ step: "exit", agent: "build", endpoint: "openrouter" }]);
  });
});
