// Recorded replies (Phase 2 decision): a Chat that returns recorded message content in order, so
// agent tests run the same JSON checks and repair as a real call, with no model and no network.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Chat } from "./chat";

/** A recording file: tests/recordings/<agent>-<set>.json. */
export const Recording = z.object({ replies: z.array(z.string()).min(1) });
export type Recording = z.infer<typeof Recording>;

export function replayChat(replies: string[]): Chat {
  let next = 0;
  return async () => {
    if (next >= replies.length) {
      throw new Error(`replayChat: no more recorded replies (all ${replies.length} used)`);
    }
    return {
      content: replies[next++]!,
      model: "replay",
      endpoint: "primary",
      tokensIn: 0,
      tokensOut: 0,
      ms: 0,
    };
  };
}

export async function loadRecording(path: string): Promise<string[]> {
  return Recording.parse(JSON.parse(await readFile(path, "utf8"))).replies;
}
