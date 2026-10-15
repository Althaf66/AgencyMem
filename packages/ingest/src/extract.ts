import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api";

/** The text of a file: one array of lines per page. Only PDFs have more than one page. */
export type Pages = string[][];

export type SourceFile = { name: string; data: Uint8Array };

const readers: Record<string, (data: Uint8Array) => Promise<Pages>> = {
  ".pdf": pdfPages,
  ".docx": docxPages,
  ".txt": textPages,
  ".md": textPages, // read as plain text, no Markdown parsing
};

/** Extracts the lines of a PDF, DOCX, TXT or MD file. Throws on any other type or a corrupt file. */
export function extract(file: SourceFile): Promise<Pages> {
  const ext = /\.[^.]*$/.exec(file.name.toLowerCase())?.[0] ?? "";
  const read = readers[ext];
  if (!read)
    throw new Error(`Cannot read "${ext || file.name}" files: use .pdf, .docx, .txt or .md`);
  return read(file.data);
}

async function textPages(data: Uint8Array): Promise<Pages> {
  return [new TextDecoder("utf-8").decode(data).split(/\r?\n/)]; // the decoder drops a BOM
}

/** mammoth puts "\n\n" between paragraphs, so one paragraph is one line, an empty one a blank line. */
async function docxPages(data: Uint8Array): Promise<Pages> {
  const { value } = await mammoth.extractRawText({ buffer: Buffer.from(data) });
  return [
    value
      .replace(/(\n\n)+$/, "")
      .split("\n\n")
      .flatMap((p) => p.split("\n")),
  ];
}

async function pdfPages(data: Uint8Array): Promise<Pages> {
  // pdf.js takes ownership of the buffer it reads, so give it a copy.
  const doc = await getDocument({ data: data.slice(), isEvalSupported: false, verbosity: 0 })
    .promise;
  try {
    const pages: Pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(pdfLines(content.items.filter((i): i is TextItem => "str" in i)));
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

type PdfLine = { text: string; y: number; height: number; endX: number };

/**
 * Rebuilds the lines of one page from pdf.js text items, with the blank lines that pdf.js drops: a
 * gap of n line pitches between two lines means n - 1 blank lines.
 * ponytail: assumes one column of text in one font size, in reading order. Multi-column or rotated
 * pages come out as lines in content order; mixed font sizes can give too many blank lines; blank
 * lines at the top of a page are lost (nothing above to measure from). Line numbers still repeat.
 */
function pdfLines(items: TextItem[]): string[] {
  const lines: PdfLine[] = [];
  for (const item of items) {
    if (item.str === "") continue; // pdf.js end-of-line markers
    const [x, y] = [item.transform[4] as number, item.transform[5] as number];
    const last = lines.at(-1);
    if (last && Math.abs(last.y - y) < Math.max(last.height, item.height) / 2) {
      const gap = x - last.endX > 1 && !/\s$/.test(last.text) && !/^\s/.test(item.str);
      last.text += (gap ? " " : "") + item.str;
      last.endX = x + item.width;
      last.height = Math.max(last.height, item.height);
    } else {
      lines.push({ text: item.str, y, height: item.height, endX: x + item.width });
    }
  }

  // The pitch is the smallest single-spaced step on the page. A page of one-line paragraphs has
  // none, so fall back to the usual leading of 1.15 times the font height.
  const steps = lines.slice(1).map((line, i) => [lines[i]!.y - line.y, line.height] as const);
  const single = steps.filter(([step, height]) => step > 0 && step <= 1.5 * height);
  const pitch = single.length
    ? Math.min(...single.map(([step]) => step))
    : 1.15 * Math.max(0, ...lines.map((l) => l.height));

  const out: string[] = [];
  lines.forEach((line, i) => {
    const step = i === 0 ? 0 : lines[i - 1]!.y - line.y;
    if (pitch > 0 && step > 0)
      out.push(...Array<string>(Math.max(0, Math.round(step / pitch) - 1)).fill(""));
    out.push(line.text);
  });
  return out;
}
