// Evidence of context: after recall_context or get_task_context answers, the item gets a RECALLED
// edge to every node the answer named, and a context.read event lists them. The Pipeline screen
// and the card story show these as "what the agent read from the graph".
import { Id, type ToolInput, type ToolName } from "@agencymem/contracts";
import { recordRecall } from "@agencymem/memory";
import { agentOf, memoryCtx, type Outcome, type ToolCtx } from "./common";

/** The node ids (`id`, `…Id`, `…Ids`) and keys (`key`, `…Key`, `…Keys`) anywhere in a value. */
export function namesIn(value: unknown, out = { ids: new Set<string>(), keys: new Set<string>() }) {
  if (Array.isArray(value)) {
    for (const v of value) namesIn(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      const strings = (Array.isArray(v) ? v : [v]).filter(
        (x): x is string => typeof x === "string",
      );
      if (k === "id" || k.endsWith("Id") || k.endsWith("Ids")) {
        for (const s of strings) if (Id.safeParse(s).success) out.ids.add(s);
      } else if (k === "key" || k.endsWith("Key") || k.endsWith("Keys")) {
        for (const s of strings) out.keys.add(s);
      }
      namesIn(v, out);
    }
  }
  return out;
}

type ContextTool = "recall_context" | "get_task_context";

/** `handler`, plus the RECALLED edges and the context.read event after a success. */
export function recorded<K extends ContextTool>(
  tool: K,
  handler: (ctx: ToolCtx, input: ToolInput<K>) => Promise<Outcome<unknown>>,
  itemOf: (input: ToolInput<K>) => string,
) {
  return async (ctx: ToolCtx, input: ToolInput<K>): Promise<Outcome<unknown>> => {
    const outcome = await handler(ctx, input);
    if (!outcome.ok) return outcome;
    const itemId = itemOf(input);
    const { ids, keys } = namesIn(outcome.output);
    try {
      const { agent } = agentOf(ctx);
      const read = await recordRecall(memoryCtx(ctx), {
        itemId,
        agent,
        ids: [...ids],
        keys: [...keys],
        now: ctx.now(),
      });
      ctx.events.emit(ctx.binding.projectId, "context.read", { itemId, agent, tool, ids: read });
    } catch (e) {
      // Evidence only: a failed record must not fail the agent's read.
      console.error(`gateway: ${tool as ToolName} evidence: ${e instanceof Error ? e.message : e}`);
    }
    return outcome;
  };
}
