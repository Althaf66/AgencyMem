// One chat call with the fallback rule of the technical design (Model routing): the primary
// endpoint with 2 retries and backoff, then OpenRouter with the tier's OpenRouter model.
import OpenAI, { APIConnectionError, APIError } from "openai";
import type { Config, Endpoint } from "@agencymem/contracts";
import { ModelRequestError, ModelUnavailableError } from "./errors";

export type Tier = "thin" | "deep";
export type Message = { role: "system" | "user" | "assistant"; content: string };
export type ChatRequest = { tier: Tier; messages: Message[]; maxTokens: number };
export type ChatReply = {
  content: string;
  model: string;
  endpoint: Endpoint;
  tokensIn: number;
  tokensOut: number;
  ms: number;
};
export type Chat = (req: ChatRequest) => Promise<ChatReply>;

export type LlmConfig = Pick<
  Config,
  | "LLM_BASE_URL"
  | "LLM_API_KEY"
  | "LLM_MODEL_THIN"
  | "LLM_MODEL_DEEP"
  | "OPENROUTER_API_KEY"
  | "OPENROUTER_MODEL_THIN"
  | "OPENROUTER_MODEL_DEEP"
  | "LLM_TIMEOUT_MS"
>;

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

type Target = { endpoint: Endpoint; client: OpenAI; models: Record<Tier, string> };

/** The SDK retries network errors, timeouts, 408, 409, 429 and 5xx itself (maxRetries 2). Only
 * those failures, once the retries are used up, move on to the next endpoint. */
const isUnavailable = (e: unknown) =>
  e instanceof APIConnectionError ||
  (e instanceof APIError && (e.status === 429 || (e.status ?? 0) >= 500));

// agent-prompts.md (P): an endpoint that refuses response_format gets the request once without it.
const refusesJsonMode = (e: unknown) =>
  e instanceof APIError && e.status === 400 && /response_format/i.test(e.message);

async function ask(target: Target, req: ChatRequest, jsonMode: boolean) {
  return target.client.chat.completions.create({
    model: target.models[req.tier],
    messages: req.messages,
    temperature: 0, // so pre-runs repeat
    max_tokens: req.maxTokens,
    ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
  });
}

/**
 * A Chat over the configured endpoints. `openRouterBaseUrl` exists for tests; the technical design
 * fixes OpenRouter's URL.
 */
export function createChat(cfg: LlmConfig, opts: { openRouterBaseUrl?: string } = {}): Chat {
  const timeout = required(cfg.LLM_TIMEOUT_MS, "LLM_TIMEOUT_MS");
  const targets: Target[] = [
    {
      endpoint: "primary",
      client: new OpenAI({
        baseURL: required(cfg.LLM_BASE_URL, "LLM_BASE_URL"),
        apiKey: required(cfg.LLM_API_KEY, "LLM_API_KEY"),
        timeout,
        maxRetries: 2,
        // Never pick up OPENAI_ORG_ID or OPENAI_PROJECT_ID from the environment as headers.
        organization: null,
        project: null,
      }),
      models: {
        thin: required(cfg.LLM_MODEL_THIN, "LLM_MODEL_THIN"),
        deep: required(cfg.LLM_MODEL_DEEP, "LLM_MODEL_DEEP"),
      },
    },
    {
      endpoint: "openrouter",
      client: new OpenAI({
        baseURL: opts.openRouterBaseUrl ?? OPENROUTER_BASE_URL,
        apiKey: required(cfg.OPENROUTER_API_KEY, "OPENROUTER_API_KEY"),
        timeout,
        maxRetries: 2,
        // Never pick up OPENAI_ORG_ID or OPENAI_PROJECT_ID from the environment as headers.
        organization: null,
        project: null,
      }),
      models: {
        thin: required(cfg.OPENROUTER_MODEL_THIN, "OPENROUTER_MODEL_THIN"),
        deep: required(cfg.OPENROUTER_MODEL_DEEP, "OPENROUTER_MODEL_DEEP"),
      },
    },
  ];

  return async (req) => {
    // ms covers the whole step: after a fallback it includes the failed primary tries.
    const started = Date.now();
    let lastError: unknown;
    for (const target of targets) {
      try {
        let answer;
        try {
          answer = await ask(target, req, true);
        } catch (e) {
          if (!refusesJsonMode(e)) throw e;
          answer = await ask(target, req, false);
        }
        return {
          content: answer.choices[0]?.message.content ?? "",
          model: target.models[req.tier],
          endpoint: target.endpoint,
          tokensIn: answer.usage?.prompt_tokens ?? 0,
          tokensOut: answer.usage?.completion_tokens ?? 0,
          ms: Date.now() - started,
        };
      } catch (e) {
        if (!isUnavailable(e)) {
          const status = e instanceof APIError ? e.status : undefined;
          throw new ModelRequestError(e instanceof Error ? e.message : String(e), status);
        }
        lastError = e;
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ModelUnavailableError(`Both model endpoints failed: ${reason}`);
  };
}
