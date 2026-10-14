// What every tool handler shares: its context, its outcome, and the guard and lookup steps.
import type { Actor, AgentId, Rejection, ToolName } from "@agencymem/contracts";
import { readQuery, type FalkorDB } from "@agencymem/graph";
import type { Ctx } from "@agencymem/memory";
import type { Events } from "../../events/bus";
import { rejectAndCount, tenancy, type GuardResult } from "../guards";
import type { Binding } from "../session";

export type ToolCtx = {
  tool: ToolName;
  binding: Binding;
  db: FalkorDB;
  events: Events;
  leaseMs: number;
  recallMaxChars: number;
  now: () => number;
};

export type Outcome<T> = { ok: true; output: T } | { ok: false; error: Rejection };

export const ok = <T>(output: T): Outcome<T> => ({ ok: true, output });
export const fail = (error: Rejection): { ok: false; error: Rejection } => ({ ok: false, error });
export const invalid = (reason: string) => fail({ code: "VALIDATION_FAILED", reason });
export const notFound = (what: string) =>
  fail({ code: "NOT_FOUND", reason: `${what} does not exist in this project.` });

/** Who the session acts as. MCP sessions carry no X-AM-Actor, so a UI session is `human:ui`. */
export const actor = (ctx: ToolCtx): Actor =>
  ctx.binding.kind === "agent" ? ctx.binding.agent : "human:ui";

export const memoryCtx = (ctx: ToolCtx): Ctx => ({
  db: ctx.db,
  graph: ctx.binding.graph,
  projectId: ctx.binding.projectId,
});

/**
 * The agent of an agent session. Every tool but read_query runs only in agent sessions: the
 * dispatcher rejects a UI session with ownership before the handler runs.
 */
export function agentOf(ctx: ToolCtx): { agent: AgentId; workerId: string } {
  if (ctx.binding.kind !== "agent") throw new Error(`${ctx.tool} needs an agent session`);
  return ctx.binding;
}

/** Counts a guard's rejection, sends its events, and returns it as the tool's failure. */
export async function guardFail(ctx: ToolCtx, result: GuardResult) {
  return fail(
    await rejectAndCount(ctx.db, ctx.binding.projectId, result, {
      events: ctx.events,
      tool: ctx.tool,
      agent: actor(ctx),
    }),
  );
}

export type Props = Record<string, unknown>;
export const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
export const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** Any node of the session's client graph by id, with its label. */
export async function readNode(
  ctx: ToolCtx,
  id: string,
): Promise<{ label: string; props: Props } | null> {
  const [row] = await readQuery<{ n: { properties: Props }; label: string }>(
    ctx.db,
    ctx.binding.graph,
    "read/node",
    { id },
  );
  return row ? { label: row.label, props: row.n.properties } : null;
}

/**
 * The node `id`, with one of `labels`, when it belongs to the session's project. A node that does
 * not exist is NOT_FOUND (not a guard rejection); another project's node is tenancy FOREIGN_NODE.
 */
export async function findOwn(
  ctx: ToolCtx,
  id: string,
  labels: string | string[],
): Promise<Outcome<Props>> {
  const wanted = typeof labels === "string" ? [labels] : labels;
  const found = await readNode(ctx, id);
  if (!found || !wanted.includes(found.label)) return notFound(`${wanted.join(" or ")} ${id}`);
  const foreign = tenancy({
    projectId: ctx.binding.projectId,
    known: true,
    nodes: [{ id, projectId: str(found.props.projectId) }],
  });
  if (foreign) return guardFail(ctx, foreign);
  return ok(found.props);
}
