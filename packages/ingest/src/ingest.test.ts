import { Document, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";
import { describe, expect, it } from "vitest";
import { ingest, type EpisodeDraft } from "./index";

/** Builds a PDF the way scripts/build-fixtures.ts does: A4, Helvetica 10 pt, 50 pt margins. */
async function pdf(pages: (string[] | "shapes")[]): Promise<Uint8Array> {
  const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const ended = new Promise((resolve) => doc.on("end", resolve));
  for (const page of pages) {
    doc.addPage().font("Helvetica").fontSize(10);
    if (page === "shapes") doc.rect(100, 100, 200, 100).fill("#888888");
    else for (const line of page) doc.text(line === "" ? " " : line); // " " keeps the blank line height
  }
  doc.end();
  await ended;
  return new Uint8Array(Buffer.concat(chunks));
}

/** One paragraph per line; an empty paragraph is a blank line (approved rule). */
async function docx(lines: string[]): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{ children: lines.map((text) => new Paragraph({ text })) }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

const utf8 = (text: string) => new TextEncoder().encode(text);

// Line 3 is blank, lines 5 and 6 are blank: three paragraphs.
const LINES = [
  "Kickoff with Ravi, clinic manager.",
  "Each appointment slot is 20 minutes long.",
  "",
  "The clinic is open Monday to Saturday, 9 am to 5 pm.",
  "",
  "",
  "A phone number is required for every booking.",
];
const EPISODES: EpisodeDraft[] = [
  {
    page: 1,
    lineStart: 1,
    lineEnd: 2,
    text: "Kickoff with Ravi, clinic manager.\nEach appointment slot is 20 minutes long.",
  },
  {
    page: 1,
    lineStart: 4,
    lineEnd: 4,
    text: "The clinic is open Monday to Saturday, 9 am to 5 pm.",
  },
  { page: 1, lineStart: 7, lineEnd: 7, text: "A phone number is required for every booking." },
];
const WORDS = 5 + 7 + 12 + 8;

describe("Done when: fixture files give the same episodes on every run", () => {
  const files: [string, () => Promise<Uint8Array>][] = [
    ["kickoff-notes.pdf", () => pdf([LINES])],
    ["client-summary.docx", () => docx(LINES)],
    ["whatsapp-chat.txt", async () => utf8(LINES.join("\n"))],
    ["notes.md", async () => utf8(LINES.join("\n"))],
  ];

  it.each(files)("%s: one episode per paragraph, with page and line range", async (name, build) => {
    const data = await build();
    const first = await ingest({ name, data });
    expect(first).toEqual({ status: "processed", episodes: EPISODES, wordCount: WORDS });
    expect(await ingest({ name, data })).toEqual(first);
  });

  it("restarts PDF line numbers on each page, and skips a page with no text", async () => {
    const data = await pdf([
      ["Page one, line one.", "Page one, line two."],
      "shapes",
      ["Page three, line one.", "", "Page three, line three."],
    ]);
    expect((await ingest({ name: "x.pdf", data })).episodes).toEqual([
      { page: 1, lineStart: 1, lineEnd: 2, text: "Page one, line one.\nPage one, line two." },
      { page: 3, lineStart: 1, lineEnd: 1, text: "Page three, line one." },
      { page: 3, lineStart: 3, lineEnd: 3, text: "Page three, line three." },
    ]);
  });

  it("reads a PDF passed as a Node Buffer, as an upload or a file read gives it", async () => {
    const data = Buffer.from(await pdf([LINES]));
    expect((await ingest({ name: "a.pdf", data })).episodes).toEqual(EPISODES);
    expect(data.length).toBeGreaterThan(0); // the caller's buffer is not taken over
  });

  it("gives no_text and no episodes for a PDF with no text layer (US-01)", async () => {
    const data = await pdf(["shapes"]);
    expect(await ingest({ name: "scanned.pdf", data })).toEqual({
      status: "no_text",
      episodes: [],
      wordCount: 0,
    });
  });
});

describe("split rules (contracts.md, ingest rules)", () => {
  it("reads CRLF and a byte order mark like plain lines, and trims line ends", async () => {
    const data = utf8("﻿" + LINES.map((l) => l + "  ").join("\r\n"));
    expect((await ingest({ name: "a.txt", data })).episodes).toEqual(EPISODES);
  });

  it("splits a paragraph longer than 12 lines at the line end before the limit", async () => {
    const lines = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}.`);
    const { episodes } = await ingest({ name: "a.txt", data: utf8(lines.join("\n")) });
    expect(episodes.map((e) => [e.lineStart, e.lineEnd])).toEqual([
      [1, 12],
      [13, 15],
    ]);
  });

  it("splits a paragraph longer than 1,200 characters at the line end before the limit", async () => {
    const lines = Array.from({ length: 5 }, (_, i) => String(i + 1).repeat(300));
    const { episodes } = await ingest({ name: "a.txt", data: utf8(lines.join("\n")) });
    expect(episodes.map((e) => [e.lineStart, e.lineEnd])).toEqual([
      [1, 3],
      [4, 5],
    ]);
    expect(episodes[0]!.text).toHaveLength(3 * 300 + 2);
  });

  it("cuts a single line over 1,200 characters at a space; each part keeps the line number", async () => {
    const long = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ");
    const { episodes, wordCount } = await ingest({
      name: "a.md",
      data: utf8(`# Notes\n\n${long}`),
    });
    expect(episodes[0]).toEqual({ page: 1, lineStart: 1, lineEnd: 1, text: "# Notes" });
    const parts = episodes.slice(1);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part).toMatchObject({ page: 1, lineStart: 3, lineEnd: 3 });
      expect(part.text.length).toBeLessThanOrEqual(1200);
    }
    expect(parts.map((p) => p.text).join(" ")).toBe(long);
    expect(wordCount).toBe(502);
  });

  it("gives no_text for a text file with only white space", async () => {
    expect(await ingest({ name: "a.txt", data: utf8(" \n\n\t\n") })).toEqual({
      status: "no_text",
      episodes: [],
      wordCount: 0,
    });
  });

  it("refuses a file type it cannot read", async () => {
    await expect(ingest({ name: "notes.rtf", data: utf8("x") })).rejects.toThrow(/\.rtf/);
  });
});
