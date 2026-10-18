// The model client against two local stub endpoints (node:http), never a real model.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RunInput } from "@agencymem/contracts";
import { z } from "zod";
import {
  ModelCheckError,
  ModelOutputError,
  ModelRequestError,
  ModelUnavailableError,
  createChat,
  createModelClient,
  loadRecording,
  replayChat,
  type Chat,
} from "./index";

type Reply = { status: number; body?: unknown; hang?: boolean };
type Stub = { url: string; requests: Record<string, unknown>[]; replies: Reply[]; server: Server };

const completion = (content: string, model: string) => ({
  id: "c1",
  object: "chat.completion",
  created: 0,
  model,
  choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
});

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

/** An endpoint that answers each request with the next reply; the last reply repeats. */
async function stub(): Promise<Stub> {
  const s = { requests: [], replies: [] } as unknown as Stub;
  s.server = createServer(async (req, res) => {
    s.requests.push(await body(req));
    const reply = s.replies[Math.min(s.requests.length - 1, s.replies.length - 1)]!;
    if (reply.hang) return; // never answers: the client times out
    res.writeHead(reply.status, { "content-type": "application/json", "retry-after-ms": "1" });
    res.end(JSON.stringify(reply.body ?? { error: { message: "stub error" } }));
  });
  await new Promise<void>((resolve) => s.server.listen(0, "127.0.0.1", resolve));
  s.url = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}/v1`;
  return s;
}

let primary: Stub;
let openRouter: Stub;
const cfg = () => ({
  LLM_BASE_URL: primary.url,
  LLM_API_KEY: "test-key",
  LLM_MODEL_THIN: "primary-thin",
  LLM_MODEL_DEEP: "primary-deep",
  OPENROUTER_API_KEY: "test-or-key",
  OPENROUTER_MODEL_THIN: "or-thin",
  OPENROUTER_MODEL_DEEP: "or-deep",
  LLM_TIMEOUT_MS: 300,
});
const chat = () => createChat(cfg(), { openRouterBaseUrl: openRouter.url });

const Output = z.object({ facts: z.array(z.object({ id: z.string(), value: z.string() })) });
const good = JSON.stringify({ facts: [{ id: "f1", value: "20" }] });
const ask = {
  tier: "deep" as const,
  system: "You are a test agent.",
  user: "CONTEXT: {}\nTASK: Test.",
  schema: Output,
};

beforeAll(async () => {
  primary = await stub();
  openRouter = await stub();
});
afterEach(() => {
  for (const s of [primary, openRouter]) {
    s.requests.length = 0;
    s.replies.length = 0;
  }
});
afterAll(() =>
  Promise.all([primary, openRouter].map((s) => new Promise((r) => s.server.close(r)))),
);

describe("Done when: the primary returns 500, OpenRouter answers, and the Run records which endpoint answered", () => {
  it("retries the primary twice, then asks OpenRouter with the tier's OpenRouter model", async () => {
    primary.replies.push({ status: 500 });
    openRouter.replies.push({ status: 200, body: completion(good, "or-deep") });
    const { output, runs } = await createModelClient({ chat: chat() }).json(ask);

    expect(output).toEqual({ facts: [{ id: "f1", value: "20" }] });
    expect(primary.requests).toHaveLength(3); // the first try and 2 retries
    expect(openRouter.requests).toHaveLength(1);
    expect(openRouter.requests[0]).toMatchObject({ model: "or-deep", temperature: 0 });
    expect(RunInput.parse(runs[0])).toEqual(runs[0]); // complete_item accepts it
    expect(runs).toEqual([
      {
        step: "think",
        model: "or-deep",
        endpoint: "openrouter",
        tokensIn: 120,
        tokensOut: 30,
        ms: expect.any(Number),
        cost: expect.any(Number),
      },
    ]);
  });
});

describe("fallback rule (technical design, Model routing)", () => {
  it("answers from the primary when it is up, with the tier's model", async () => {
    primary.replies.push({ status: 200, body: completion(good, "primary-thin") });
    const { runs } = await createModelClient({ chat: chat() }).json({ ...ask, tier: "thin" });
    expect(primary.requests[0]).toMatchObject({
      model: "primary-thin",
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_object" },
    });
    expect(runs[0]).toMatchObject({ endpoint: "primary", model: "primary-thin" });
    expect(openRouter.requests).toHaveLength(0);
  });

  it("falls back on 429 and on a timeout", async () => {
    primary.replies.push({ status: 429 });
    openRouter.replies.push({ status: 200, body: completion(good, "or-deep") });
    expect((await createModelClient({ chat: chat() }).json(ask)).runs[0]!.endpoint).toBe(
      "openrouter",
    );

    primary.requests.length = 0;
    primary.replies.splice(0, 1, { status: 200, hang: true });
    expect((await createModelClient({ chat: chat() }).json(ask)).runs[0]!.endpoint).toBe(
      "openrouter",
    );
  });

  it("logs why the primary failed before it falls back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    primary.replies.push({ status: 429 });
    openRouter.replies.push({ status: 200, body: completion(good, "or-deep") });
    await createModelClient({ chat: chat() }).json(ask);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^llm: primary failed \(429/));
    warn.mockRestore();
  });

  it("does not fall back on a 4xx other than 429: the request itself is wrong", async () => {
    primary.replies.push({ status: 401 });
    await expect(createModelClient({ chat: chat() }).json(ask)).rejects.toBeInstanceOf(
      ModelRequestError,
    );
    expect(primary.requests).toHaveLength(1);
    expect(openRouter.requests).toHaveLength(0);
  });

  it("throws ModelUnavailableError when both endpoints fail", async () => {
    primary.replies.push({ status: 503 });
    openRouter.replies.push({ status: 502 });
    await expect(createModelClient({ chat: chat() }).json(ask)).rejects.toBeInstanceOf(
      ModelUnavailableError,
    );
    expect(openRouter.requests).toHaveLength(3);
  });

  it("sends the request once more without response_format when the endpoint refuses it", async () => {
    primary.replies.push(
      {
        status: 400,
        body: { error: { message: "response_format is not supported by this model" } },
      },
      { status: 200, body: completion(good, "primary-deep") },
    );
    await createModelClient({ chat: chat() }).json(ask);
    expect(primary.requests).toHaveLength(2);
    expect(primary.requests[1]).not.toHaveProperty("response_format");
  });
});

describe("JSON check and one repair (agent-prompts.md, Model request)", () => {
  it("puts the output JSON schema in the system message", async () => {
    primary.replies.push({ status: 200, body: completion(good, "primary-deep") });
    await createModelClient({ chat: chat() }).json(ask);
    const messages = primary.requests[0]!.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toMatch(/^You are a test agent\.\n\nOutput JSON schema:\n\{/);
    expect(messages[1]).toEqual({ role: "user", content: ask.user });
  });

  it("repairs once: bad JSON, then the corrected JSON", async () => {
    primary.replies.push(
      { status: 200, body: completion("not json", "primary-deep") },
      { status: 200, body: completion(good, "primary-deep") },
    );
    const { output, runs } = await createModelClient({ chat: chat() }).json(ask);
    expect(output.facts).toHaveLength(1);
    expect(runs.map((r) => r.step)).toEqual(["think", "repair"]);
    const repair = primary.requests[1]!.messages as { role: string; content: string }[];
    expect(repair.slice(2)).toEqual([
      { role: "assistant", content: "not json" },
      {
        role: "user",
        content: expect.stringMatching(
          /^Your JSON failed these checks:\n- .+\nReturn the corrected JSON only\.$/s,
        ),
      },
    ]);
  });

  it("reads JSON wrapped in a ```json fence without a repair", async () => {
    primary.replies.push({
      status: 200,
      body: completion("```json\n" + good + "\n```", "primary-deep"),
    });
    const { output, runs } = await createModelClient({ chat: chat() }).json(ask);
    expect(output.facts).toHaveLength(1);
    expect(runs.map((r) => r.step)).toEqual(["think"]);
  });

  it("repairs a schema error and a reference error from check()", async () => {
    primary.replies.push(
      { status: 200, body: completion(JSON.stringify({ facts: [{ id: 1 }] }), "primary-deep") },
      {
        status: 200,
        body: completion(JSON.stringify({ facts: [{ id: "f9", value: "x" }] }), "primary-deep"),
      },
    );
    const check = (o: z.infer<typeof Output>) =>
      o.facts.filter((f) => f.id !== "f1").map((f) => `${f.id} is not in CONTEXT`);
    const err = await createModelClient({ chat: chat() })
      .json({ ...ask, check })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelOutputError);
    expect((err as ModelOutputError).errors).toEqual(["f9 is not in CONTEXT"]);
    expect((err as ModelOutputError).runs.map((r) => r.step)).toEqual(["think", "repair"]);
    const repair = primary.requests[1]!.messages as { content: string }[];
    expect(repair[3]!.content).toMatch(/facts\.0\.id/); // the schema error names the field
  });

  it("turns a check() that throws into ModelCheckError with the runs so far", async () => {
    primary.replies.push({
      status: 200,
      body: completion(JSON.stringify({ facts: [{ id: "f1", value: "x" }] }), "primary-deep"),
    });
    const check = async () => {
      throw new Error("git worktree add failed");
    };
    const err = await createModelClient({ chat: chat() })
      .json({ ...ask, check })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelCheckError);
    expect((err as ModelCheckError).message).toBe("check failed: git worktree add failed");
    expect((err as ModelCheckError).runs.map((r) => r.step)).toEqual(["think"]);
  });

  it("waits for an async check(), and repairs once on its errors", async () => {
    const good = JSON.stringify({ facts: [{ id: "f1", value: "x" }] });
    const bad = JSON.stringify({ facts: [{ id: "f9", value: "x" }] });
    primary.replies.push(
      { status: 200, body: completion(bad, "primary-deep") },
      { status: 200, body: completion(good, "primary-deep") },
    );
    const check = async (o: z.infer<typeof Output>) => {
      await new Promise((r) => setTimeout(r, 5));
      return o.facts.filter((f) => f.id !== "f1").map((f) => `${f.id} is not on disk`);
    };
    const { output, runs } = await createModelClient({ chat: chat() }).json({ ...ask, check });
    expect(output.facts[0]!.id).toBe("f1");
    expect(runs.map((r) => r.step)).toEqual(["think", "repair"]);
    const repair = primary.requests[1]!.messages as { content: string }[];
    expect(repair[3]!.content).toMatch(/f9 is not on disk/);
  });
});

describe("meter", () => {
  it("prices a known model by its tokens, and an unknown model at 0", async () => {
    primary.replies.push({ status: 200, body: completion(good, "primary-deep") });
    const prices = { "primary-deep": { inPerMillion: 1, outPerMillion: 10 } };
    const { runs } = await createModelClient({ chat: chat(), prices }).json(ask);
    expect(runs[0]!.cost).toBeCloseTo((120 * 1 + 30 * 10) / 1_000_000, 12);

    primary.replies.splice(0, 1, { status: 200, body: completion(good, "primary-deep") });
    primary.requests.length = 0;
    expect((await createModelClient({ chat: chat(), prices: {} }).json(ask)).runs[0]!.cost).toBe(0);
  });
});

describe("replayChat (recorded replies)", () => {
  it("gives the recorded replies in order and runs the same checks and repair", async () => {
    const recorded: Chat = replayChat(['{"facts": []', good]);
    const { output, runs } = await createModelClient({ chat: recorded }).json(ask);
    expect(output).toEqual(JSON.parse(good));
    expect(runs.map((r) => [r.step, r.model, r.endpoint])).toEqual([
      ["think", "replay", "primary"],
      ["repair", "replay", "primary"],
    ]);
    await expect(recorded({ tier: "deep", messages: [], maxTokens: 1 })).rejects.toThrow(
      /no more recorded replies/,
    );
  });

  it("loads a recording file and refuses one with no replies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "recording-"));
    try {
      await writeFile(join(dir, "intake-A.json"), JSON.stringify({ replies: [good] }));
      expect(await loadRecording(join(dir, "intake-A.json"))).toEqual([good]);
      await writeFile(join(dir, "empty.json"), JSON.stringify({ replies: [] }));
      await expect(loadRecording(join(dir, "empty.json"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("replayChat placeholders (recorded replies with ids from CONTEXT)", () => {
  const context = (doc: string) => ({
    episodes: [
      {
        id: "01JA00000000000000000000E1",
        documentName: doc,
        page: 1,
        lineStart: 4,
        lineEnd: 6,
        text: "x",
      },
      {
        id: "01JA00000000000000000000E2",
        documentName: doc,
        page: 2,
        lineStart: 1,
        lineEnd: 1,
        text: "y",
      },
    ],
  });
  const request = (doc: string) => ({
    tier: "thin" as const,
    maxTokens: 10,
    messages: [
      { role: "system" as const, content: "s" },
      {
        role: "user" as const,
        content: `CONTEXT: ${JSON.stringify(context(doc))}
TASK: t`,
      },
    ],
  });
  const forDoc = (doc: string) =>
    JSON.stringify({ ids: [`{{episode:${doc}:1:4}}`, `{{episode:${doc}:2:1}}`] });

  it("puts in the id of the CONTEXT episode, and picks the reply whose placeholders fit", async () => {
    const chat = replayChat([forDoc("a.pdf"), forDoc("b.docx")]);
    const first = await chat(request("b.docx"));
    expect(JSON.parse(first.content)).toEqual({
      ids: ["01JA00000000000000000000E1", "01JA00000000000000000000E2"],
    });
    const second = await chat(request("a.pdf"));
    expect(JSON.parse(second.content).ids).toHaveLength(2);
    await expect(chat(request("a.pdf"))).rejects.toThrow(/no more recorded replies/);
  });

  it("fails when no recorded reply fits the CONTEXT", async () => {
    const chat = replayChat([forDoc("a.pdf")]);
    await expect(chat(request("c.txt"))).rejects.toThrow(/no recorded reply fits/);
  });
});

describe("replayChat fact placeholders", () => {
  it("puts in the id of the current CONTEXT fact with that subject, attribute and value", async () => {
    const context = {
      facts: [
        {
          id: "01JA00000000000000000000F1",
          subject: "clinic",
          attribute: "hours",
          value: "9 am to 5 pm",
        },
        { id: "01JA00000000000000000000F2", subject: "clinic", attribute: "note", value: "a: b" },
      ],
    };
    const req = {
      tier: "deep" as const,
      maxTokens: 10,
      messages: [
        {
          role: "user" as const,
          content: `CONTEXT: ${JSON.stringify(context)}
TASK: t`,
        },
      ],
    };
    const chat = replayChat([
      JSON.stringify({ ids: ["{{fact:clinic:hours:9 am to 5 pm}}", "{{fact:clinic:note:a: b}}"] }),
    ]);
    expect(JSON.parse((await chat(req)).content)).toEqual({
      ids: ["01JA00000000000000000000F1", "01JA00000000000000000000F2"],
    });
  });
});

describe("replayChat answer placeholders", () => {
  it("puts in the id of the CONTEXT answer episode whose text starts with the words", async () => {
    const request = (text: string) => ({
      tier: "thin" as const,
      maxTokens: 10,
      messages: [
        {
          role: "user" as const,
          content: `CONTEXT: ${JSON.stringify({
            episodes: [{ id: "01JA00000000000000000000A1", kind: "answer", text }],
          })}
TASK: t`,
        },
      ],
    });
    const chat = replayChat([
      JSON.stringify({ id: "{{answer:No.}}" }),
      JSON.stringify({ id: "{{answer:No accounts}}" }),
    ]);
    const first = await chat(request("No accounts; the booking code is the key."));
    expect(JSON.parse(first.content)).toEqual({ id: "01JA00000000000000000000A1" });
    await expect(chat(request("Yes."))).rejects.toThrow(/no recorded reply fits/);
  });
});

describe("replayChat task placeholders", () => {
  it("puts in the card key only when CONTEXT.tasks holds that card", async () => {
    const request = (key: string) => ({
      tier: "deep" as const,
      maxTokens: 10,
      messages: [
        {
          role: "user" as const,
          content: `CONTEXT: ${JSON.stringify({ tasks: [{ id: "T", key }] })}
TASK: t`,
        },
      ],
    });
    const chat = replayChat([
      JSON.stringify({ path: "tests/e2e/{{task:CARD-01}}/AC-01-1.spec.ts" }),
      JSON.stringify({ path: "tests/e2e/{{task:CARD-02}}/AC-02-1.spec.ts" }),
    ]);
    const second = await chat(request("CARD-02"));
    expect(JSON.parse(second.content)).toEqual({ path: "tests/e2e/CARD-02/AC-02-1.spec.ts" });
    await expect(chat(request("CARD-03"))).rejects.toThrow(/no recorded reply fits/);
  });
});
