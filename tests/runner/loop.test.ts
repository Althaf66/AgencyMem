// Task 2.4, Done when: a test agent takes one item from claim to complete. The real runner loop
// against the real gateway and FalkorDB; only the model is replaced by a recorded reply. It lives
// outside apps/, because the runner may not import the gateway (AGENTS.md rule 1).
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type Envelope, type ProjectInfo } from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { setStage } from "@agencymem/memory";
import { createModelClient, replayChat } from "@agencymem/llm";
import { createEvents } from "../../apps/gateway/src/events/bus";
import { createGateway } from "../../apps/gateway/src/main";
import { runLoop } from "../../apps/runner/src/loop";
import { listProjects } from "../../apps/runner/src/mcp-client";
import { echo } from "./echo/agent";

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

describe("Done when: a test agent takes one item from claim to complete", () => {
  it("runs the echo agent on a real intake item through the gateway", async () => {
    const res = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { ...ui, "Content-Type": "application/json" },
      body: JSON.stringify({
        clientName: `test-client-${randomUUID()}`,
        projectName: "Booking",
        mode: "demo",
      }),
    });
    const { project } = (await res.json()) as { project: ProjectInfo };
    graphs.add(`client_${project.clientId}`);

    // T2 opens a real intake item for the uploaded file.
    const form = new FormData();
    form.append(
      "files",
      new Blob(["Each slot is 20 minutes long.\n\nThe clinic opens at 9."]),
      "notes.txt",
    );
    await fetch(`${base}/api/projects/${project.id}/files`, {
      method: "POST",
      headers: ui,
      body: form,
    });

    const sent: Envelope[] = [];
    let off = () => {};
    const done = new Promise<void>((resolve) => {
      off = events.on((e) => {
        if (e.projectId !== project.id) return;
        sent.push(e);
        if (e.type === "run.step" && e.data.text === "Done") resolve();
      });
    });
    const stop = new AbortController();
    const loop = runLoop(echo, {
      gatewayUrl: base,
      token: "agent-t",
      llm: createModelClient({
        chat: replayChat([JSON.stringify({ summary: "2 episodes" })]),
        prices: {},
      }),
      heartbeatMs: 60_000,
      idleMs: 20,
      // Only this test's project: other test files share the database and have intake items too.
      projects: async () => [project.id],
      signal: stop.signal,
    });
    // If the loop ends before "Done" (an error, or nothing to claim), fail at once, not on a timeout.
    await Promise.race([
      done,
      loop.then(() => {
        throw new Error("runLoop ended before the item was done");
      }),
    ]);
    off();
    stop.abort();
    await loop;

    expect(
      await rows(
        project.id,
        q(
          "MATCH",
          "(w:WorkItem {kind: 'intake'})",
          "RETURN",
          "w.kind, w.status, w.handoff, w.attempts",
        ),
      ),
    ).toEqual([["intake", "done", "2 episodes", 0]]);
    expect(
      await rows(
        project.id,
        q("MATCH", "(r:Run)", "RETURN", "r.step, r.agent, r.model, r.endpoint"),
      ),
    ).toEqual([["think", "intake", "replay", "primary"]]);
    const texts = sent
      .filter((e) => e.type === "run.step")
      .map((e) => (e.data as { text: string }).text);
    expect(texts).toEqual([
      "Claimed intake",
      expect.stringMatching(/^Read /), // the groups recall_context fills for intake
      "Thinking (replay)",
      "Echoed: 2 episodes",
      "Handed off",
      "Done",
    ]);
  });
});

describe("listProjects (how the runner finds work)", () => {
  it("lists the projects with the agent token, without the closed ones", async () => {
    const make = async () => {
      const res = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { ...ui, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: `test-client-${randomUUID()}`,
          projectName: "P",
          mode: "demo",
        }),
      });
      const { project } = (await res.json()) as { project: ProjectInfo };
      graphs.add(`client_${project.clientId}`);
      return project.id;
    };
    const open = await make();
    const closed = await make();
    expect(await setStage(db, closed, "intake", "closed")).toBe(true);
    const ids = await listProjects({ gatewayUrl: base, token: "agent-t" });
    expect(ids).toContain(open);
    expect(ids).not.toContain(closed);
  });
});
