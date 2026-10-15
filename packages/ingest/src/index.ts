import type { DocumentStatus } from "@agencymem/contracts";
import { extract, type SourceFile } from "./extract";
import { countWords, split, type EpisodeDraft } from "./split";

export { extract, type Pages, type SourceFile } from "./extract";
export { countWords, split, type EpisodeDraft } from "./split";

export type Ingested = {
  status: Extract<DocumentStatus, "processed" | "no_text">;
  episodes: EpisodeDraft[];
  wordCount: number;
};

/**
 * Turns one uploaded file into episodes. A file with no text (a PDF with no text layer) gets
 * `no_text` and no episodes. A corrupt file or an unknown type throws; the caller marks it failed.
 */
export async function ingest(file: SourceFile): Promise<Ingested> {
  const episodes = split(await extract(file));
  return {
    status: episodes.length ? "processed" : "no_text",
    episodes,
    wordCount: countWords(episodes),
  };
}
