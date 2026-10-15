// `pnpm eval:discovery --set A [--project <id>]` (fixtures.md section 6): scores Discovery's
// questions on a project against the planted list of a fixture set.
//   --project <id>  score that project (it must have finished Discovery).
//   no --project    create a project, upload the set, wait for the runner (with real model keys)
//                   to finish Discovery, then score it. Without LLM_API_KEY it reports "skipped".
// Reads GATEWAY_URL and AM_UI_TOKEN. Writes tests/discovery-eval/out/<set>.json; exit 0 on pass.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  Planted,
  ProjectInfo,
  QuestionView,
  clarityBand,
  type ClarityBand,
} from "@agencymem/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "../../apps/simulator/fixtures");
const FILES = ["kickoff-notes.pdf", "client-summary.docx", "whatsapp-chat.txt"];
const WAIT_MS = 10 * 60_000;

type Match = { id: string; questionId: string };
export type DiscoveryScore = {
  set: string;
  projectId: string;
  contradictions: {
    planted: number;
    questions: number;
    recall: number;
    precision: number;
    matched: Match[];
    missed: string[];
    falsePositives: string[];
  };
  unclear: { recall: number; matched: Match[]; missed: string[] };
  open: { recall: number; matched: Match[]; missed: string[] };
  density: number;
  band: ClarityBand;
  expectedBand: ClarityBand;
  pass: boolean; // contradiction recall >= 0.8, precision >= 0.8, band = expectedBand
};

const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** A source of the question from `file` whose text holds `line`. */
const cites = (q: QuestionView, line: { file: string; text: string }) =>
  q.sources.some((s) => s.documentName === line.file && normal(s.text).includes(normal(line.text)));

/**
 * Matches each planted item to at most one question, and each question to at most one item, as
 * many as possible (a maximum matching by augmenting paths), so a question that fits two items
 * does not cost a match. Questions in `used` belong to an earlier kind's matching.
 */
function matchAll<T extends { id: string }>(
  items: T[],
  questions: QuestionView[],
  used: Set<string>,
  fits: (item: T, q: QuestionView) => boolean,
) {
  const fitting = items.map((item) => questions.filter((q) => !used.has(q.id) && fits(item, q)));
  const holder = new Map<string, number>(); // question id -> index of the item it is matched to
  const place = (i: number, seen: Set<string>): boolean => {
    for (const q of fitting[i]!) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      const other = holder.get(q.id);
      if (other === undefined || place(other, seen)) {
        holder.set(q.id, i);
        return true;
      }
    }
    return false;
  };
  items.forEach((_, i) => place(i, new Set()));

  const byItem = new Map([...holder].map(([questionId, i]) => [i, questionId]));
  const matched: Match[] = [];
  const missed: string[] = [];
  items.forEach((item, i) => {
    const questionId = byItem.get(i);
    if (questionId === undefined) return missed.push(item.id);
    used.add(questionId);
    matched.push({ id: item.id, questionId });
  });
  const recall = items.length ? matched.length / items.length : 1;
  return { recall, matched, missed };
}

export function score(input: {
  set: string;
  projectId: string;
  questions: QuestionView[];
  planted: Planted;
  density: number;
}): DiscoveryScore {
  const { questions, planted } = input;
  const used = new Set<string>();
  const asked = questions.filter((q) => q.kind === "contradiction");
  const c = matchAll(planted.contradictions, asked, used, (item, q) =>
    item.lines.every((line) => cites(q, line)),
  );
  const unclear = matchAll(planted.unclear, questions, used, (item, q) => cites(q, item.line));
  const open = matchAll(planted.open, questions, used, (item, q) => {
    const text = normal(q.text);
    return q.kind === "open" && item.keywords.filter((k) => text.includes(normal(k))).length >= 2;
  });
  const matchedQuestions = new Set(c.matched.map((m) => m.questionId));
  const precision = asked.length ? c.matched.length / asked.length : 0;
  const band = clarityBand(input.density);
  return {
    set: input.set,
    projectId: input.projectId,
    contradictions: {
      planted: planted.contradictions.length,
      questions: asked.length,
      recall: c.recall,
      precision,
      matched: c.matched,
      missed: c.missed,
      falsePositives: asked.filter((q) => !matchedQuestions.has(q.id)).map((q) => q.id),
    },
    unclear,
    open,
    density: input.density,
    band,
    expectedBand: planted.expectedBand,
    pass: c.recall >= 0.8 && precision >= 0.8 && band === planted.expectedBand,
  };
}

// The command line.

type Gateway = { url: string; token: string };

async function api<T>(gw: Gateway, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${gw.url}${path}`, {
    ...init,
    headers: { "X-AM-Token": gw.token, "X-AM-Actor": "human:eval", ...init.headers },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Creates a project, uploads the set, and waits until Discovery is done (clarity is set). */
async function drive(gw: Gateway, set: string): Promise<string> {
  const { project } = await api<{ project: ProjectInfo }>(gw, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientName: `Eval set ${set} ${Date.now()}`,
      projectName: "Discovery eval",
      mode: "demo",
    }),
  });
  const form = new FormData();
  for (const name of FILES)
    form.append("files", new Blob([await readFile(join(FIXTURES, set, name))]), name);
  await api(gw, `/api/projects/${project.id}/files`, { method: "POST", body: form });
  console.log(`eval: project ${project.id} created; waiting for the runner to finish Discovery`);
  for (const started = Date.now(); Date.now() - started < WAIT_MS;) {
    const info = await api<{ project: ProjectInfo }>(gw, `/api/projects/${project.id}`);
    if (info.project.clarity) return project.id;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Discovery did not finish within 10 minutes. Is the runner running?");
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const set = arg("set");
  if (!set || !["A", "B", "C"].includes(set)) {
    console.error("usage: pnpm eval:discovery --set A|B|C [--project <id>]");
    return 2;
  }
  const gw = {
    url: process.env.GATEWAY_URL || "http://127.0.0.1:4000", // an empty .env value means unset
    token: process.env.AM_UI_TOKEN ?? "",
  };
  if (!gw.token) {
    console.error("eval: AM_UI_TOKEN is required");
    return 2;
  }
  let projectId = arg("project");
  if (!projectId) {
    if (!process.env.LLM_API_KEY) {
      console.log("eval: skipped (no LLM_API_KEY; the runner needs a model for Discovery)");
      return 0;
    }
    projectId = await drive(gw, set);
  }

  const planted = Planted.parse(
    JSON.parse(await readFile(join(FIXTURES, set, "planted.json"), "utf8")),
  );
  const { questions } = await api<{ questions: unknown[] }>(
    gw,
    `/api/projects/${projectId}/questions`,
  );
  const { project } = await api<{ project: ProjectInfo }>(gw, `/api/projects/${projectId}`);
  if (!project.clarity) throw new Error(`project ${projectId} has not finished Discovery`);
  const result = score({
    set,
    projectId,
    questions: questions.map((q) => QuestionView.parse(q)),
    planted,
    density: project.clarity.density,
  });

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.table({
    contradictions: {
      recall: pct(result.contradictions.recall),
      precision: pct(result.contradictions.precision),
      missed: result.contradictions.missed.join(" "),
    },
    unclear: { recall: pct(result.unclear.recall), missed: result.unclear.missed.join(" ") },
    open: { recall: pct(result.open.recall), missed: result.open.missed.join(" ") },
  });
  console.log(
    `eval: density ${result.density.toFixed(1)}, band ${result.band} (expected ${result.expectedBand}): ${result.pass ? "PASS" : "FAIL"}`,
  );
  await mkdir(join(HERE, "out"), { recursive: true });
  await writeFile(join(HERE, "out", `${set}.json`), `${JSON.stringify(result, null, 2)}\n`);
  return result.pass ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => (process.exitCode = code),
    (e: unknown) => {
      console.error(`eval: ${e instanceof Error ? e.message : String(e)}`);
      process.exitCode = 1;
    },
  );
}
