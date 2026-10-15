// Recorded replies (Phase 2 decision): a Chat that returns recorded message content, so agent tests
// run the same JSON checks and repair as a real call, with no model and no network.
//
// Node ids are new on every run, so a recording names them by placeholders that are filled in
// from the CONTEXT of the request being replayed:
//   {{episode:<documentName>:<page>:<lineStart>}}  the id of that episode in CONTEXT.episodes
//   {{fact:<subject>:<attribute>:<value>}}         the id of that current fact in CONTEXT.facts
//                                                  (the value is the rest, colons and all)
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Chat, ChatRequest } from "./chat";

/** A recording file: tests/recordings/<agent>-<set>.json. */
export const Recording = z.object({ replies: z.array(z.string()).min(1) });
export type Recording = z.infer<typeof Recording>;

const EPISODE = /\{\{episode:([^:}]+):(\d+):(\d+)\}\}/g;
const FACT = /\{\{fact:([^:}]+):([^:}]+):([^}]+)\}\}/g;

type Context = {
  episodes?: {
    id: string;
    documentName: string | null;
    page: number | null;
    lineStart: number | null;
  }[];
  facts?: { id: string; subject: string; attribute: string; value: string }[];
};

/** The CONTEXT JSON of the agent's user message (agent-prompts.md, Model request). */
function contextOf(req: ChatRequest): Context {
  const user = req.messages.find((m) => m.role === "user" && m.content.startsWith("CONTEXT: "));
  const json = user?.content.slice("CONTEXT: ".length).split("\nTASK:")[0];
  return json ? (JSON.parse(json) as Context) : {};
}

/** The reply with its placeholders filled in, or null when one does not resolve. */
function resolve(reply: string, req: ChatRequest): string | null {
  // Nothing to fill: CONTEXT is not read.
  if (!reply.includes("{{episode:") && !reply.includes("{{fact:")) return reply;
  const context = contextOf(req);
  let missing = false;
  const filled = reply.replace(EPISODE, (_all, doc: string, page: string, line: string) => {
    const found = context.episodes?.find(
      (e) => e.documentName === doc && e.page === Number(page) && e.lineStart === Number(line),
    );
    if (!found) missing = true;
    return found?.id ?? "";
  });
  const withFacts = filled.replace(
    FACT,
    (_all, subject: string, attribute: string, value: string) => {
      const found = context.facts?.find(
        (f) => f.subject === subject && f.attribute === attribute && f.value === value,
      );
      if (!found) missing = true;
      return found?.id ?? "";
    },
  );
  return missing ? null : withFacts;
}

/**
 * Gives each request the first unused reply whose placeholders all resolve in its CONTEXT, so the
 * order in which items are claimed does not matter. Replies without placeholders go in order.
 */
export function replayChat(replies: string[]): Chat {
  const used = new Set<number>();
  return async (req) => {
    if (used.size === replies.length) {
      throw new Error(`replayChat: no more recorded replies (all ${replies.length} used)`);
    }
    for (const [i, reply] of replies.entries()) {
      if (used.has(i)) continue;
      const content = resolve(reply, req);
      if (content === null) continue;
      used.add(i);
      return { content, model: "replay", endpoint: "primary", tokensIn: 0, tokensOut: 0, ms: 0 };
    }
    throw new Error("replayChat: no recorded reply fits this CONTEXT");
  };
}

export async function loadRecording(path: string): Promise<string[]> {
  return Recording.parse(JSON.parse(await readFile(path, "utf8"))).replies;
}
