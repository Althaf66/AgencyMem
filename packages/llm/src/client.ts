// The JSON request of agent-prompts.md (Model request): the output schema in the system message, a
// zod check and the agent's reference check on the reply, one repair message, and a Run per call.
import type { RunInput } from "@agencymem/contracts";
import { z } from "zod";
import type { Chat, Message, Tier } from "./chat";
import {
  ModelCheckError,
  ModelOutputError,
  ModelRequestError,
  ModelUnavailableError,
} from "./errors";
import { PRICES, costOf, type Prices } from "./prices";

export type JsonRequest<T> = {
  tier: Tier;
  /** prompt.md; the output JSON schema is appended. */
  system: string;
  /** CONTEXT: and TASK: lines. */
  user: string;
  schema: z.ZodType<T>;
  /** Reference errors, such as an id that is not in CONTEXT. Empty means the output is good. A
   * check that needs I/O (the Test agent lists its spec files) returns a Promise. */
  check?: (output: T) => string[] | Promise<string[]>;
  maxTokens?: number;
};

export type ModelClient = {
  json<T>(req: JsonRequest<T>): Promise<{ output: T; runs: RunInput[] }>;
};

const MAX_TOKENS = 4000;

async function validate<T>(
  content: string,
  req: JsonRequest<T>,
): Promise<{ output?: T; errors: string[] }> {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    return { errors: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const parsed = req.schema.safeParse(raw);
  if (!parsed.success) {
    return {
      errors: parsed.error.issues.map(
        (i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
      ),
    };
  }
  const errors = (await req.check?.(parsed.data)) ?? [];
  return errors.length ? { errors } : { output: parsed.data, errors: [] };
}

const repairMessage = (errors: string[]) =>
  `Your JSON failed these checks:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn the corrected JSON only.`;

export function createModelClient(deps: { chat: Chat; prices?: Prices }): ModelClient {
  const prices = deps.prices ?? PRICES;
  const unpriced = new Set<string>();
  const cost = (model: string, tokensIn: number, tokensOut: number) => {
    const priced = costOf(prices, model, tokensIn, tokensOut);
    if (priced === null) {
      if (!unpriced.has(model))
        console.warn(`llm: no price for model ${model}; its cost counts as 0`);
      unpriced.add(model);
    }
    return priced ?? 0;
  };

  return {
    async json<T>(req: JsonRequest<T>) {
      // io "input": the JSON the model must send, before any defaults or transforms.
      const schemaText = JSON.stringify(z.toJSONSchema(req.schema, { io: "input" }), null, 2);
      let messages: Message[] = [
        { role: "system", content: `${req.system}\n\nOutput JSON schema:\n${schemaText}` },
        { role: "user", content: req.user },
      ];
      const runs: RunInput[] = [];
      for (const step of ["think", "repair"] as const) {
        let reply;
        try {
          reply = await deps.chat({
            tier: req.tier,
            messages,
            maxTokens: req.maxTokens ?? MAX_TOKENS,
          });
        } catch (e) {
          // The calls that did answer still count toward the item's usage.
          if (e instanceof ModelUnavailableError || e instanceof ModelRequestError) e.runs = runs;
          throw e;
        }
        runs.push({
          step,
          model: reply.model,
          endpoint: reply.endpoint,
          tokensIn: reply.tokensIn,
          tokensOut: reply.tokensOut,
          ms: reply.ms,
          cost: cost(reply.model, reply.tokensIn, reply.tokensOut),
        });
        let checked: Awaited<ReturnType<typeof validate<T>>>;
        try {
          checked = await validate(reply.content, req);
        } catch (e) {
          const error = new ModelCheckError(`check failed: ${e instanceof Error ? e.message : e}`);
          error.runs = runs;
          throw error;
        }
        const { output, errors } = checked;
        if (output !== undefined) return { output, runs };
        if (step === "repair") {
          const error = new ModelOutputError(errors);
          error.runs = runs;
          throw error;
        }
        messages = [
          ...messages,
          { role: "assistant", content: reply.content },
          { role: "user", content: repairMessage(errors) },
        ];
      }
      throw new Error("unreachable"); // the loop returns or throws on its second step
    },
  };
}
