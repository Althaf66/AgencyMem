// contracts.md section 10: WebSocket events and messages.
import { z } from "zod";
import { Actor, CardKey, Count, EpochMs, Id, text } from "./common";
import { AgentId, Column, GateKey, GateStatus, GuardName } from "./enums";
import { Rejection } from "./errors";
import { NodeLabel } from "./nodes";

const Version = z.int().min(1);

/** The `data` of each event type. */
export const eventData = {
  "node.written": z.object({
    label: NodeLabel,
    id: Id,
    version: Version,
    summary: text(120),
    ids: z.array(Id).optional(), // every node of a batch write
  }),
  "node.ended": z.object({ factId: Id, validTo: EpochMs, replacedBy: Id }),
  "task.moved": z.object({
    taskId: Id,
    key: CardKey,
    from: Column.nullable(), // null for a new card
    to: Column,
    version: Version,
    reason: z.string().optional(),
  }),
  "task.edited": z.object({
    taskId: Id,
    fields: z.array(z.string()),
    version: Version,
    actor: Actor,
  }),
  "lease.changed": z.object({
    itemId: Id,
    owner: z.string().nullable(),
    until: EpochMs.nullable(),
    reason: z.enum(["claim", "renew", "release", "expire", "cancel"]),
  }),
  "gate.changed": z.object({
    gateId: Id,
    gateKey: GateKey,
    status: GateStatus,
    decidedBy: Actor.nullable(),
    reason: z.string().nullable(),
  }),
  "doc.stale": z.object({ docSectionId: Id, crId: Id }),
  "run.step": z.object({
    itemId: Id,
    agent: AgentId,
    step: z.string(),
    text: z.string(),
    model: z.string().nullable(),
    tokens: Count,
    ms: Count,
  }),
  "write.rejected": z.object({
    tool: z.string(), // the MCP tool name or the REST route, for example `PATCH /api/tasks/:id`
    guard: GuardName,
    reasonCode: z.string(),
    reason: z.string(),
    agent: Actor,
  }),
  "metrics.updated": z.object({ metric: z.string(), value: z.number() }),
  // An agent read its context from the graph: the nodes the answer named, now RECALLED edges.
  "context.read": z.object({
    itemId: Id,
    agent: AgentId,
    tool: z.enum(["recall_context", "get_task_context"]),
    ids: z.array(Id),
  }),
  // The live preview of the project's built app changed: started, ready, stopped, failed, or more log.
  "preview.changed": z.object({
    status: z.enum(["stopped", "installing", "starting", "ready", "failed"]),
    url: z.string().nullable(),
    log: z.array(z.string()),
  }),
} as const;

export const EventType = z.enum(
  Object.keys(eventData) as [keyof typeof eventData, ...(keyof typeof eventData)[]],
);
export type EventType = z.infer<typeof EventType>;
/** The `data` an emitter passes for one event type. */
export type EventData<T extends EventType> = z.input<(typeof eventData)[T]>;

const envelope = <T extends EventType>(type: T) =>
  z.object({
    projectId: Id,
    seq: z.int().min(1),
    type: z.literal(type),
    at: EpochMs,
    data: eventData[type],
  });

export const Envelope = z.discriminatedUnion("type", [
  envelope("node.written"),
  envelope("node.ended"),
  envelope("task.moved"),
  envelope("task.edited"),
  envelope("lease.changed"),
  envelope("gate.changed"),
  envelope("doc.stale"),
  envelope("run.step"),
  envelope("write.rejected"),
  envelope("metrics.updated"),
  envelope("context.read"),
  envelope("preview.changed"),
]);
export type Envelope = z.infer<typeof Envelope>;

/** Client to server. */
export const SubscribeMessage = z.object({
  type: z.literal("subscribe"),
  projectId: Id,
  since: Count.optional(),
});
export type SubscribeMessage = z.infer<typeof SubscribeMessage>;

/** Server to client. `reset` tells the client to reload its snapshots. */
export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), event: Envelope }),
  z.object({ type: z.literal("reset"), projectId: Id, seq: Count }),
  z.object({ type: z.literal("error"), error: Rejection }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;
