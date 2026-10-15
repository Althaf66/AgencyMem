// `pnpm fixtures:build` (fixtures.md section 1): builds the PDF and DOCX of each note set from its
// source/ text, then checks every set. Any failed check exits 1. The output is committed, so tests
// do not depend on the build. The DOCX bytes change on every build (the docx package writes the
// current time into the file); its text does not, so rebuild only when a source changes.
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  FixtureSet,
  Planted,
  TruthSheet,
  clarityBand,
  type FixtureFile,
  type PlantedLine,
} from "@agencymem/contracts";
import { ingest } from "@agencymem/ingest";
import { Document, Packer, Paragraph } from "docx";
import PDFDocument from "pdfkit";

export const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "simulator",
  "fixtures",
);

const SOURCE: Record<FixtureFile, string> = {
  "kickoff-notes.pdf": "source/kickoff-notes.txt",
  "client-summary.docx": "source/client-summary.txt",
  "whatsapp-chat.txt": "source/whatsapp-chat.txt",
};
const FILES = Object.keys(SOURCE) as FixtureFile[];

/** Target words per file (fixtures.md section 3), counted the way ingest counts them. */
const WORDS: Record<FixtureSet, Record<FixtureFile, number>> = {
  A: { "kickoff-notes.pdf": 600, "client-summary.docx": 400, "whatsapp-chat.txt": 400 },
  B: { "kickoff-notes.pdf": 600, "client-summary.docx": 400, "whatsapp-chat.txt": 400 },
  C: { "kickoff-notes.pdf": 700, "client-summary.docx": 500, "whatsapp-chat.txt": 400 },
};
const WORD_TOLERANCE = 0.1;
const MAX_FIXED = 90;
// The text width of an A4 page with 50 pt margins. A wider line would wrap in the PDF.
const PDF_WIDTH = 595.28 - 2 * 50;
const BANNED = [
  "fast", "quick", "simple", "modern", "easy", "easily", "nice", "few", "some", "several", "many",
  "enough", "friendly", "professional", "properly", "soon", "flexible", "user-friendly", "etc.",
  "as needed",
]; // prettier-ignore
const CHAT_PREFIX = /^\[[A-Z][a-z]{2} \d{2}:\d{2}\] [^:]+: /;

const pdfOptions = {
  size: "A4",
  margin: 50,
  // Fixed dates, so the same source gives the same PDF bytes.
  info: { CreationDate: new Date(0), ModDate: new Date(0) },
} as const;

function newPdf(): { doc: PDFKit.PDFDocument; done: Promise<Buffer> } {
  const doc = new PDFDocument(pdfOptions);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  doc.font("Helvetica").fontSize(10);
  return { doc, done };
}

/** One source line per PDF line. A blank line is " ": pdfkit's text("") does not move down. */
async function buildPdf(lines: string[]): Promise<Buffer> {
  const { doc, done } = newPdf();
  for (const line of lines) doc.text(line === "" ? " " : line);
  doc.end();
  return done;
}

/** One source line per paragraph; an empty paragraph is a blank line (ingest reads it back so). */
async function buildDocx(lines: string[]): Promise<Buffer> {
  const children = lines.map((text) => new Paragraph({ text }));
  return Packer.toBuffer(new Document({ creator: "AgencyMem fixtures", sections: [{ children }] }));
}

/** A page with drawn shapes and no text layer (US-01). */
async function buildScanned(): Promise<Buffer> {
  const { doc, done } = newPdf();
  doc.rect(80, 80, 300, 160).fill("#9ca3af").circle(300, 420, 90).fill("#6b7280");
  doc.end();
  return done;
}

// CRLF-safe: a Windows checkout may turn LF into CRLF (.gitattributes keeps the fixtures LF).
const linesOf = (text: string) => text.replace(/\r?\n$/, "").split(/\r?\n/);

export async function buildSet(dir: string): Promise<void> {
  const read = async (file: FixtureFile) =>
    linesOf(await readFile(join(dir, SOURCE[file]), "utf8"));
  await writeFile(join(dir, "kickoff-notes.pdf"), await buildPdf(await read("kickoff-notes.pdf")));
  await writeFile(
    join(dir, "client-summary.docx"),
    await buildDocx(await read("client-summary.docx")),
  );
  await copyFile(join(dir, SOURCE["whatsapp-chat.txt"]), join(dir, "whatsapp-chat.txt"));
}

const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bannedIn = (line: string) =>
  BANNED.filter((w) => new RegExp(`(?<![\\w-])${escape(w)}(?![\\w-])`, "i").test(line));

/** Checks one note set against fixtures.md rules 1, 2, 3 and 6, the round trip and the targets. */
export async function checkSet(dir: string): Promise<string[]> {
  const errors: string[] = [];
  const parsedTruth = TruthSheet.safeParse(
    JSON.parse(await readFile(join(dir, "truth.json"), "utf8")),
  );
  const parsedPlanted = Planted.safeParse(
    JSON.parse(await readFile(join(dir, "planted.json"), "utf8")),
  );
  if (!parsedTruth.success) errors.push(`truth.json: ${parsedTruth.error.message}`);
  if (!parsedPlanted.success) errors.push(`planted.json: ${parsedPlanted.error.message}`);
  if (!parsedTruth.success || !parsedPlanted.success) return errors;
  const truth = parsedTruth.data;
  const planted = parsedPlanted.data;
  if (truth.set !== planted.set)
    errors.push(`truth.json is set ${truth.set}, planted.json is set ${planted.set}`);

  // Every C-, U- and O- item has exactly one answer.
  const ids = [...planted.contradictions, ...planted.unclear, ...planted.open].map((p) => p.id);
  for (const id of ids) {
    const n = truth.answers.filter((a) => a.plantedId === id).length;
    if (n !== 1) errors.push(`${id}: ${n === 0 ? "no answer" : `${n} answers`} in truth.json`);
  }
  for (const a of truth.answers) {
    if (!ids.includes(a.plantedId)) errors.push(`${a.plantedId}: answer for no planted item`);
  }

  const fixed: { id: string; line: PlantedLine }[] = [
    ...planted.contradictions.flatMap((c) => c.lines.map((line) => ({ id: c.id, line }))),
    ...planted.unclear.map((u) => ({ id: u.id, line: u.line })),
    ...planted.support.map((line) => ({ id: "support", line })),
  ];
  if (planted.contradictions.length < 5)
    errors.push(`${planted.contradictions.length} contradictions, at least 5 needed (task 2.9)`);
  for (const c of planted.contradictions) {
    if (c.lines[0].file === c.lines[1].file)
      errors.push(`${c.id}: both lines in the same file (rule 3)`);
  }

  const source = {} as Record<FixtureFile, string[]>;
  for (const file of FILES) source[file] = linesOf(await readFile(join(dir, SOURCE[file]), "utf8"));
  // In the chat, the fixed text is the message after the time and name prefix.
  const message = (file: FixtureFile, line: string) =>
    file === "whatsapp-chat.txt" ? line.replace(CHAT_PREFIX, "") : line;

  for (const { id, line } of fixed) {
    if (line.text.length > MAX_FIXED)
      errors.push(`${id}: "${line.text}" is over ${MAX_FIXED} characters (rule 2)`);
    const n = source[line.file].filter((l) => message(line.file, l) === line.text).length;
    if (n === 0) errors.push(`${id}: "${line.text}" not found in ${line.file} (rule 1)`);
    if (n > 1) errors.push(`${id}: "${line.text}" found ${n} times in ${line.file} (rule 1)`);
    for (const other of FILES.filter((f) => f !== line.file)) {
      if (source[other].some((l) => message(other, l) === line.text))
        errors.push(`${id}: "${line.text}" also appears in ${other} (rule 1)`);
    }
  }

  // Filler never uses the banned words; fixed lines may (rule 6).
  for (const file of FILES) {
    const fixedHere = new Set(fixed.filter((f) => f.line.file === file).map((f) => f.line.text));
    source[file].forEach((line, i) => {
      if (fixedHere.has(message(file, line))) return;
      for (const word of bannedIn(line))
        errors.push(`${file} line ${i + 1}: filler uses "${word}" (rule 6)`);
    });
  }

  // No kickoff line is wider than the PDF page, so PDF lines follow the source lines.
  const { doc } = newPdf();
  source["kickoff-notes.pdf"].forEach((line, i) => {
    if (doc.widthOfString(line) > PDF_WIDTH)
      errors.push(`kickoff-notes.pdf line ${i + 1} wraps in the PDF`);
  });

  // Round trip: each built file, read back by ingest, holds each fixed line inside one episode.
  const chat = await readFile(join(dir, "whatsapp-chat.txt"), "utf8");
  if (chat !== (await readFile(join(dir, SOURCE["whatsapp-chat.txt"]), "utf8"))) {
    errors.push("whatsapp-chat.txt differs from its source: run pnpm fixtures:build");
  }
  let words = 0;
  for (const file of FILES) {
    const result = await ingest({ name: file, data: await readFile(join(dir, file)) });
    words += result.wordCount;
    const target = WORDS[planted.set][file];
    if (Math.abs(result.wordCount - target) > target * WORD_TOLERANCE) {
      errors.push(
        `${file}: ${result.wordCount} words, target ${target} ± ${WORD_TOLERANCE * 100}%`,
      );
    }
    // A built file whose text differs from its source is stale.
    if (normal(result.episodes.map((e) => e.text).join(" ")) !== normal(source[file].join(" ")))
      errors.push(`${file} does not match its source: run pnpm fixtures:build`);
    const episodes = result.episodes.map((e) => normal(e.text));
    for (const { id, line } of fixed.filter((f) => f.line.file === file)) {
      if (!episodes.some((e) => e.includes(normal(line.text)))) {
        errors.push(`${id}: "${line.text}" does not come back inside one episode of ${file}`);
      }
    }
  }

  // The band holds at the planted density, at 80% recall and with 20% false flags (section 3).
  const density = ((planted.contradictions.length + planted.unclear.length) * 1000) / words;
  for (const factor of [1, 0.8, 1.2]) {
    const band = clarityBand(density * factor);
    if (band !== planted.expectedBand) {
      errors.push(
        `density ${(density * factor).toFixed(1)} is band ${band}, expected ${planted.expectedBand}`,
      );
    }
  }
  return errors;
}

async function main(): Promise<void> {
  let failed = false;
  for (const set of FixtureSet.options) {
    const dir = join(FIXTURES_DIR, set);
    await buildSet(dir);
    const errors = await checkSet(dir);
    console.log(`fixtures: set ${set}: ${errors.length ? `${errors.length} problems` : "ok"}`);
    for (const e of errors) console.error(`  ${e}`);
    failed ||= errors.length > 0;
  }
  const scanned = join(FIXTURES_DIR, "negative", "scanned.pdf");
  await writeFile(scanned, await buildScanned());
  const negative = await ingest({ name: "scanned.pdf", data: await readFile(scanned) });
  console.log(`fixtures: negative/scanned.pdf: ${negative.status}`);
  if (negative.status !== "no_text") failed = true;
  if (failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e: unknown) => {
    console.error(`fixtures: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
