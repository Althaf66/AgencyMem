// The lease sweeper (contracts.md section 10, P): every 30 seconds it frees the claimed work items
// whose lease ended and tells the screens. Card (Task) expiry arrives with claim_task (task 4.2).
import { REGISTRY_GRAPH, clientGraphName, readQuery, type FalkorDB } from "@agencymem/graph";
import { expireLeases } from "@agencymem/memory";
import type { Events } from "./bus";

export const SWEEP_MS = 30_000;

/** One sweep over every project in the registry. A project that fails is logged and skipped. */
export async function sweepOnce(
  deps: { db: FalkorDB; events: Events },
  now: number,
): Promise<void> {
  const projects = await readQuery<{ id: string; clientId: string }>(
    deps.db,
    REGISTRY_GRAPH,
    "read/projects",
    {},
  );
  const graphs = new Set(await deps.db.list());
  for (const project of projects) {
    const graph = clientGraphName(project.clientId);
    // A write query on a graph that does not exist creates it; never bring a graph back.
    // ponytail: a graph deleted between db.list() and the write would still come back; graphs are
    // only deleted by tests today.
    if (!graphs.has(graph)) continue;
    try {
      const freed = await expireLeases({ db: deps.db, graph, projectId: project.id }, { now });
      for (const item of freed) {
        deps.events.emit(project.id, "lease.changed", {
          itemId: item.id,
          owner: null,
          until: null,
          reason: "expire",
        });
        deps.events.emit(project.id, "node.written", {
          label: "WorkItem",
          id: item.id,
          version: item.version,
          summary: `${item.kind} item ${item.status}: lease ended`,
        });
      }
    } catch (e) {
      console.error(
        `sweeper: project ${project.id}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Starts the sweeper. Returns a function that stops it. A round that is still running is not doubled. */
export function startLeaseSweeper(
  deps: { db: () => Promise<FalkorDB>; events: Events },
  everyMs = SWEEP_MS,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    deps
      .db()
      .then((db) => sweepOnce({ db, events: deps.events }, Date.now()))
      .catch(() => undefined) // FalkorDB down: /healthz reports it; try again next round
      .finally(() => {
        running = false;
      });
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
