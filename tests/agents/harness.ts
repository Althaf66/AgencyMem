// What the agent end-to-end tests share: the real gateway on a free port, a project with a fixture
// set uploaded, and an agent loop run on recorded replies until a given number of items are done.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  type Envelope,
  type GateView,
  type ProjectInfo,
  type QuestionView,
} from "@agencymem/contracts";
import { close, connect, type FalkorDB } from "@agencymem/graph";
import { deleteTestClient } from "@agencymem/memory";
import { createModelClient, loadRecording, replayChat } from "@agencymem/llm";
import { createEvents, type Events } from "../../apps/gateway/src/events/bus";
import { createGateway } from "../../apps/gateway/src/main";
import type { Agent } from "../../apps/runner/src/agent";
import { runLoop } from "../../apps/runner/src/loop";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../../apps/simulator/fixtures");
const FILES = ["kickoff-notes.pdf", "client-summary.docx", "whatsapp-chat.txt"];
const TOKENS = { AM_AGENT_TOKEN: "agent-t", AM_UI_TOKEN: "ui-t", AM_HOOK_TOKEN: "hook-t" };
const FALKORDB_URL = process.env.FALKORDB_URL ?? "redis://localhost:6380";
export const ui = { "X-AM-Token": "ui-t", "X-AM-Actor": "human:ana" };
// Set A's own answers, by question index (route 8 order); every other question accepts its
// recommendation. intake-answer-A.json has one Intake reply per answer.
export const OWN_A: Record<number, string> = {
  1: "Closed on Saturday; open Monday to Friday.",
  9: "Under 3 seconds on a 4G phone.",
};

export type Harness = {
  base: string;
  events: Events;
  /** A project with the fixture set's three files uploaded (T2 opens an intake item each). */
  project(set: string): Promise<ProjectInfo>;
  /** Runs `agent` on the recording until `items` of its items in the project are done. */
  run(agent: Agent<unknown>, recording: string, projectId: string, items: number): Promise<void>;
  /** Answers every question as `own` says (route 9), then approves G1 (route 11). */
  answerAndApprove(projectId: string, own: Record<number, string>): Promise<void>;
  /** A read query on the project's client graph: rows of values. */
  rows(projectId: string, cypher: string): Promise<unknown[][]>;
  stop(): Promise<void>;
};

export async function startHarness(): Promise<Harness> {
  const db: FalkorDB = await connect(FALKORDB_URL);
  const events = createEvents();
  const server: Server = createGateway(loadConfig({ ...TOKENS, FALKORDB_URL }, "gateway"), {
    events,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const graphs = new Set<string>();

  return {
    base,
    events,
    async project(set) {
      const res = await fetch(`${base}/api/projects`, {
        method: "POST",
        headers: { ...ui, "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: `test-client-${randomUUID()}`,
          projectName: "Clinic booking",
          mode: "demo",
        }),
      });
      const { project } = (await res.json()) as { project: ProjectInfo };
      graphs.add(`client_${project.clientId}`);
      const form = new FormData();
      for (const name of FILES) {
        form.append("files", new Blob([await readFile(join(FIXTURES, set, name))]), name);
      }
      await fetch(`${base}/api/projects/${project.id}/files`, {
        method: "POST",
        headers: ui,
        body: form,
      });
      return project;
    },
    async run(agent, recording, projectId, items) {
      let off = () => {};
      const done = new Promise<void>((resolve) => {
        let count = 0;
        off = events.on((e: Envelope) => {
          if (e.projectId !== projectId || e.type !== "run.step") return;
          if (e.data.text === "Done" && ++count === items) resolve();
        });
      });
      const replies = await loadRecording(join(HERE, "../recordings", recording));
      const stop = new AbortController();
      const loop = runLoop(agent, {
        gatewayUrl: base,
        token: "agent-t",
        llm: createModelClient({ chat: replayChat(replies), prices: {} }),
        heartbeatMs: 60_000,
        idleMs: 20,
        projects: async () => [projectId], // other test files share the database
        signal: stop.signal,
      });
      try {
        await Promise.race([
          done,
          loop.then(() => {
            throw new Error(`runLoop ended before ${items} ${agent.id} items were done`);
          }),
        ]);
      } finally {
        off();
        stop.abort();
        await loop;
      }
    },
    async answerAndApprove(projectId, own) {
      const json = { ...ui, "Content-Type": "application/json", "X-AM-Project": projectId };
      const get = async <T>(path: string) =>
        (await (await fetch(`${base}${path}`, { headers: json })).json()) as T;
      const post = (path: string, body: unknown) =>
        fetch(`${base}${path}`, { method: "POST", headers: json, body: JSON.stringify(body) });
      const { questions } = await get<{ questions: QuestionView[] }>(
        `/api/projects/${projectId}/questions`,
      );
      for (const [i, { id, version }] of questions.entries()) {
        await post(
          `/api/questions/${id}/answer`,
          own[i] ? { version, accept: false, text: own[i] } : { version, accept: true },
        );
      }
      const { gates } = await get<{ gates: GateView[] }>(`/api/projects/${projectId}/gates`);
      const g1 = gates.find((g) => g.key === "G1")!;
      const res = await post(`/api/gates/${g1.id}/decision`, {
        version: g1.version,
        decision: "approve",
      });
      if (!res.ok) throw new Error(`G1 approve failed: ${res.status}`);
    },
    async rows(projectId, cypher) {
      const res = await fetch(`${base}/api/query`, {
        method: "POST",
        headers: { ...ui, "Content-Type": "application/json", "X-AM-Project": projectId },
        body: JSON.stringify({ graph: "client", cypher }),
      });
      return ((await res.json()) as { rows: unknown[][] }).rows;
    },
    async stop() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      for (const graph of graphs) await deleteTestClient(db, graph);
      await close();
    },
  };
}
