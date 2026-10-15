// The JSON request of agent-prompts.md (Model request): the output schema in the system message, a
// zod check and the agent's reference check on the reply, one repair message, and a Run per call.
import type { RunInput } from "@agencymem/contracts";
import { z } from "zod";
import type { Chat, Message, Tier } from "./chat";
import { ModelOutputError, ModelRequestError, ModelUnavailableError } from "./errors";
import { PRICES, type Prices } from "./prices";

export type JsonRequest<T> = {
  tier: Tier;
  /** prompt.md; the output JSON schema is appended. */
  system: string;
  /** CONTEXT: and TASK: lines. */
  user: string;
  schema: z.ZodType<T>;
  /** Reference errors, such as an id that is not in CONTEXT. Empty means the output is good. */
  check?: (output: T) => string[];
  maxTokens?: number;
};

export type ModelClient = {
  json<T>(req: JsonRequest<T>): Promise<{ output: T; runs: RunInput[] }>;
};

const MAX_TOKENS = 4000;

function validate<T>(content: string, req: JsonRequest<T>): { output?: T; errors: string[] } {
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
  const errors = req.check?.(parsed.data) ?? [];
  return errors.length ? { errors } : { output: parsed.data, errors: [] };
}

const repairMessage = (errors: string[]) =>
  `Your JSON failed these checks:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn the corrected JSON only.`;

export function createModelClient(deps: { chat: Chat; prices?: Prices }): ModelClient {
  const prices = deps.prices ?? PRICES;
  const unpriced = new Set<string>();
  const cost = (model: string, tokensIn: number, tokensOut: number) => {
    const price = prices[model];
    if (!price) {
      if (!unpriced.has(model))
        console.warn(`llm: no price for model ${model}; its cost counts as 0`);
      unpriced.add(model);
      return 0;
    }
    return (tokensIn * price.inPerMillion + tokensOut * price.outPerMillion) / 1_000_000;
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
        const { output, errors } = validate(reply.content, req);
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
