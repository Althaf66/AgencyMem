import type { Pages } from "./extract";

/** One episode before it is written: a paragraph with its page and line range. */
export type EpisodeDraft = { page: number; lineStart: number; lineEnd: number; text: string };

const MAX_LINES = 12;
const MAX_CHARS = 1200;

/**
 * Splits pages into episodes by the ingest rules in contracts.md: lines are numbered from 1 on each
 * page, an episode is one paragraph (lines between blank lines), and a paragraph splits at the line
 * end before 12 lines or 1,200 characters. A single line over 1,200 characters is cut at its last
 * space before the limit; every part keeps the line's number.
 */
export function split(pages: Pages): EpisodeDraft[] {
  const episodes: EpisodeDraft[] = [];
  pages.forEach((lines, p) => {
    let open: { lines: string[]; start: number; end: number } | null = null;
    const flush = () => {
      if (open) {
        const text = open.lines.join("\n");
        episodes.push({ page: p + 1, lineStart: open.start, lineEnd: open.end, text });
      }
      open = null;
    };
    lines.forEach((raw, i) => {
      const line = raw.trimEnd();
      if (line.trim() === "") return flush();
      for (const part of cut(line)) {
        const size = open ? open.lines.join("\n").length + 1 + part.length : 0;
        if (open && (open.lines.length >= MAX_LINES || size > MAX_CHARS)) flush();
        if (open) {
          open.lines.push(part);
          open.end = i + 1;
        } else open = { lines: [part], start: i + 1, end: i + 1 };
      }
    });
    flush();
  });
  return episodes;
}

function cut(line: string): string[] {
  const parts: string[] = [];
  let rest = line;
  while (rest.length > MAX_CHARS) {
    const space = rest.lastIndexOf(" ", MAX_CHARS);
    const at = space > 0 ? space : MAX_CHARS;
    parts.push(rest.slice(0, at));
    rest = rest.slice(space > 0 ? at + 1 : at);
  }
  return [...parts, rest];
}

/** Whitespace-separated tokens of all episodes (ingest rule 5). */
export function countWords(episodes: EpisodeDraft[]): number {
  return episodes.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);
}
