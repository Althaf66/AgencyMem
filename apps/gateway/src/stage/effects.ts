// Runs the stage machine after a triggering write (stage-machine.md section 1, rule 1): reads the
// state, asks machine.next, runs each effect through one memory function and sends its events.
import type { Id, WorkItemKind } from "@agencymem/contracts";
import { REGISTRY_GRAPH, graphFor, readQuery, type FalkorDB } from "@agencymem/graph";
import {
  cancelItems,
  createGates,
  openItem,
  reopenGate,
  setStage,
  type Ctx,
} from "@agencymem/memory";
import type { Events } from "../events/bus";
import { next, type Effect, type StageEvent } from "./machine";
import { readStageState } from "./state";

export type Opened = { id: Id; kind: WorkItemKind };

// The message only, never the error object: a connection error must not log the FalkorDB URL.
const message = (e: unknown) => (e instanceof Error ? e.message : "error");

async function apply(ctx: Ctx, effect: Effect, events: Events, now: number): Promise<Opened[]> {
  switch (effect.type) {
    case "create_gates": {
      const gates = await createGates(ctx, { keys: effect.keys, createdBy: effect.createdBy, now });
      if (gates.length) {
        events.emit(ctx.projectId, "node.written", {
          label: "Gate",
          id: gates[0]!.id,
          version: 1,
          summary: `Gates ${gates.map((g) => g.key).join(", ")} waiting`,
          ids: gates.map((g) => g.id),
        });
      }
      return [];
    }
    case "open_item": {
      const item = await openItem(ctx, { ...effect, now });
      if (!item) return []; // an open or claimed item of that kind and subject exists (rule 2)
      events.emit(ctx.projectId, "node.written", {
        label: "WorkItem",
        id: item.id,
        version: item.version,
        summary: `${item.kind} item open`,
      });
      return [{ id: item.id, kind: item.kind }];
    }
    case "reopen_gate": {
      const gate = await reopenGate(ctx, { key: effect.key });
      if (!gate) return []; // already waiting (rule 2)
      events.emit(ctx.projectId, "gate.changed", {
        gateId: gate.id,
        gateKey: gate.key,
        status: gate.status,
        decidedBy: gate.decidedBy,
        reason: gate.reason,
      });
      return [];
    }
    case "cancel_items": {
      for (const { item, claimed } of await cancelItems(ctx, { kinds: effect.kinds })) {
        if (claimed) {
          events.emit(ctx.projectId, "lease.changed", {
            itemId: item.id,
            owner: null,
            until: null,
            reason: "cancel",
          });
        }
        events.emit(ctx.projectId, "node.written", {
          label: "WorkItem",
          id: item.id,
          version: item.version,
          summary: `${item.kind} item cancelled`,
        });
      }
      return [];
    }
  }
}

/**
 * Runs the machine for one event of one project. Each effect is idempotent, so a failed one is
 * logged and retried once (rule 3); the startup event repairs whatever is still missing.
 * ponytail: if a first try commits but its reply is lost, the retry finds the node already there
 * and sends no node.written for it. The graph is right; a client sees it on its next snapshot.
 * Returns the work items it opened.
 */
export async function runStage(
  db: FalkorDB,
  events: Events,
  projectId: string,
  event: StageEvent,
): Promise<Opened[]> {
  const graph = await graphFor(db, projectId);
  const state = await readStageState(db, projectId, graph);
  if (!state) return [];
  const result = next(state, event);
  const ctx: Ctx = { db, graph, projectId };
  const opened: Opened[] = [];
  for (const effect of result.effects) {
    try {
      opened.push(...(await apply(ctx, effect, events, Date.now())));
    } catch (first) {
      console.error(`stage: ${effect.type} failed for ${projectId}, retrying: ${message(first)}`);
      try {
        opened.push(...(await apply(ctx, effect, events, Date.now())));
      } catch (second) {
        console.error(`stage: ${effect.type} failed again for ${projectId}: ${message(second)}`);
      }
    }
  }
  if (result.stage && result.stage !== state.stage) {
    await setStage(db, projectId, state.stage, result.stage);
  }
  return opened;
}

/** On gateway start: runs the machine once per project with `startup` (rule 3). */
export async function startup(db: FalkorDB, events: Events): Promise<void> {
  const rows = await readQuery<{ id: string }>(db, REGISTRY_GRAPH, "read/projects", {});
  for (const { id } of rows) {
    try {
      await runStage(db, events, id, { type: "startup" });
    } catch (e) {
      console.error(`stage: startup repair failed for ${id}: ${message(e)}`);
    }
  }
}
