import type { DesignLabel, ToolInput, ToolOutput } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { lease } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  notFound,
  num,
  ok,
  str,
  type Outcome,
  type ToolCtx,
} from "./common";

type Out = ToolOutput<"get_task_context">;

type Row = {
  t: { properties: Record<string, unknown> };
  requirements: { key: string; text: string }[];
  facts: { id: string; statement: string }[];
  criteria: Out["criteria"];
  design: {
    label: DesignLabel;
    key: string;
    name: string;
    body: string;
    method: string | null;
    path: string | null;
  }[];
  testCases: Out["testCases"];
  codeChanges: Out["codeChanges"];
  episodes: {
    id: string;
    page: number | null;
    lineStart: number | null;
    lineEnd: number | null;
    text: string;
    createdAt: number;
  }[];
  documents: { id: string; name: string }[];
};

/** The sample app's rules a build run must follow (sample-app.md sections 1 and 8). */
const CONVENTIONS = {
  testIdRule:
    "Every element that an acceptance criterion names has a data-testid, and specs find " +
    "elements only by it. Form: <page>-<element> or <page>-<element>-<qualifier>, kebab-case, " +
    "lower case. Items in a list add their id: doctors-item-d2, admin-bookings-item-K7Q2ZP. " +
    "Dates are yyyy-mm-dd; times are HHmm in clinic time: slots-slot-2026-11-03-1020. An error " +
    "for a field is <page>-error-<field>: book-error-phone. A name never changes after a card " +
    "uses it. A card that needs a new element adds a new name.",
  stack:
    "Node.js 22.13+, Express 5.2.1 serving /api and Vite as middleware in one process, SQLite " +
    "through node:sqlite, React 18.3.1 with Vite 8.3.1 and a hash router, @playwright/test " +
    "1.63.0 (Chromium), npm.",
};

const EXCERPT = 300;

/**
 * Cuts a context until its JSON fits `max` (contracts.md section 7, get_task_context): episode
 * excerpts to 300 characters, then episodes from the oldest, then code changes from the oldest,
 * then design bodies to 300. The task, criteria and test cases are never cut. `episodes` and
 * `codeChanges` come oldest first. `chars` is the length of the JSON returned.
 */
export function fitContext(context: Out, max: number): Out {
  const out: Out = { ...context, truncated: false };
  const size = () => JSON.stringify({ ...out, chars: max }).length; // `max` has the most digits
  if (size() > max && out.episodes.some((e) => e.excerpt.length > EXCERPT)) {
    out.episodes = out.episodes.map((e) => ({ ...e, excerpt: e.excerpt.slice(0, EXCERPT) }));
    out.truncated = true;
  }
  while (size() > max && out.episodes.length > 0) {
    out.episodes = out.episodes.slice(1);
    out.truncated = true;
  }
  while (size() > max && out.codeChanges.length > 0) {
    out.codeChanges = out.codeChanges.slice(1);
    out.truncated = true;
  }
  if (size() > max && out.design.some((n) => n.body.length > EXCERPT)) {
    out.design = out.design.map((n) => ({ ...n, body: n.body.slice(0, EXCERPT) }));
    out.truncated = true;
  }
  // The length includes the digits of `chars` itself; two rounds settle it.
  let chars = 0;
  for (let i = 0; i < 3; i++) chars = JSON.stringify({ ...out, chars }).length;
  return { ...out, chars };
}

/**
 * get_task_context (contracts.md section 7). Guard: lease. Everything an OpenCode run needs for
 * the card it holds, within CONTEXT_MAX_CHARS.
 */
export async function getTaskContextTool(
  ctx: ToolCtx,
  input: ToolInput<"get_task_context">,
): Promise<Outcome<Out>> {
  const { workerId } = agentOf(ctx);
  const own = await findOwn(ctx, input.taskId, "Task");
  if (!own.ok) return own;
  const held = lease(
    { owner: str(own.output.leaseOwner), until: num(own.output.leaseUntil) },
    workerId,
    ctx.now(),
  );
  if (held) return guardFail(ctx, held);

  const [row] = await readQuery<Row>(ctx.db, ctx.binding.graph, "read/task-context", {
    projectId: ctx.binding.projectId,
    taskId: input.taskId,
  });
  const requirement = row?.requirements[0];
  if (!row || !requirement) return notFound(`The requirement of Task ${input.taskId}`);
  const t = row.t.properties;

  // One episode can source several facts; each shows once, oldest first.
  const documentOf = new Map(row.documents.map((d) => [d.id, d.name]));
  const episodes = [...new Map(row.episodes.map((e) => [e.id, e])).values()].sort(
    (a, b) =>
      a.createdAt - b.createdAt ||
      (a.page ?? 0) - (b.page ?? 0) ||
      (a.lineStart ?? 0) - (b.lineStart ?? 0),
  );

  return ok(
    fitContext(
      {
        task: {
          id: input.taskId,
          key: String(t.key),
          title: String(t.title),
          description: String(t.description),
          lane: t.lane as Out["task"]["lane"],
          kind: t.kind as Out["task"]["kind"],
          version: Number(t.version),
          branch: `card/${String(t.key)}`,
          note: str(t.note),
        },
        requirement: { ...requirement, facts: row.facts },
        criteria: row.criteria,
        design: row.design.map(({ method, path, ...n }) => ({
          ...n,
          ...(method ? { method } : {}),
          ...(path ? { path } : {}),
        })),
        testCases: row.testCases,
        codeChanges: [...row.codeChanges].sort((a, b) => a.committedAt - b.committedAt),
        episodes: episodes.map((e) => ({
          documentName: documentOf.get(e.id) ?? null,
          page: e.page,
          lineStart: e.lineStart,
          lineEnd: e.lineEnd,
          excerpt: e.text,
        })),
        conventions: CONVENTIONS,
        truncated: false,
        chars: 0,
      },
      ctx.contextMaxChars,
    ),
  );
}
