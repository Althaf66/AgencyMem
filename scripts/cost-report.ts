// `pnpm cost:report --project <id>` (task 6.5): the tokens and cost of one project's model calls,
// by agent and model, priced from the meter's table (packages/llm/src/prices.ts), and the cost of 3
// pre-run projects. Runs recorded before a model had a price are priced again here. Reads the
// project's graph straight from FalkorDB (FALKORDB_URL); writes scripts/out/cost-<id>.json.
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { ConfigSchema } from "@agencymem/contracts";
import {
  REGISTRY_GRAPH,
  close,
  connect,
  graphFor,
  readQuery,
  type FalkorDB,
} from "@agencymem/graph";
import { PRICES, costOf, type Prices } from "@agencymem/llm";

type Row = {
  agent: string;
  model: string;
  runs: number;
  tokensIn: number;
  tokensOut: number;
  cost: number;
};

/** The pre-run plan: at most 3 projects (implementation plan, Pre-run). */
const PRE_RUN_PROJECTS = 3;
const cents = (usd: number) => Math.round(usd * 100) / 100;

export function costReport(input: {
  projectId: string;
  stage: string;
  rows: Row[];
  prices: Prices;
}) {
  const groups = input.rows
    .map((r) => {
      const priced = costOf(input.prices, r.model, r.tokensIn, r.tokensOut);
      // No price: the cost the Runs recorded (0 unless the meter had a price at the time).
      return { ...r, recordedCost: r.cost, cost: priced ?? r.cost, priced: priced !== null };
    })
    .sort((a, b) => b.cost - a.cost || a.agent.localeCompare(b.agent));
  const sum = (key: "runs" | "tokensIn" | "tokensOut" | "cost") =>
    groups.reduce((n, g) => n + g[key], 0);
  const total = {
    runs: sum("runs"),
    tokensIn: sum("tokensIn"),
    tokensOut: sum("tokensOut"),
    cost: cents(sum("cost")),
  };
  return {
    projectId: input.projectId,
    stage: input.stage,
    complete: input.stage === "closed",
    groups,
    total,
    threeProjects: cents(sum("cost") * PRE_RUN_PROJECTS),
    unpriced: [...new Set(groups.filter((g) => !g.priced).map((g) => g.model))],
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const projectId = arg("project");
  if (!projectId) {
    console.error("usage: pnpm cost:report --project <id>");
    return 1;
  }
  const url = ConfigSchema.shape.FALKORDB_URL.parse(process.env.FALKORDB_URL);
  let db: FalkorDB;
  try {
    db = await connect(url);
  } catch {
    // Host and port only: a Redis URL can carry a password (AGENTS.md rule 10), as in seed.ts.
    console.error(`cost: FalkorDB is not reachable at ${new URL(url).host}.`);
    return 1;
  }
  try {
    const graph = await graphFor(db, projectId);
    const [project] = await readQuery<{ p: { properties: { stage: string } } }>(
      db,
      REGISTRY_GRAPH,
      "read/project",
      { projectId },
    );
    const rows = await readQuery<Row>(db, graph, "read/run-costs", { projectId });
    const report = costReport({
      projectId,
      stage: project!.p.properties.stage,
      rows,
      prices: PRICES,
    });
    console.table(
      report.groups.map((g) => ({
        agent: g.agent,
        model: g.model,
        runs: g.runs,
        tokensIn: g.tokensIn,
        tokensOut: g.tokensOut,
        cost: g.priced
          ? `$${g.cost.toFixed(4)}`
          : g.cost > 0
            ? `$${g.cost.toFixed(4)} (recorded)`
            : "no price",
      })),
    );
    console.log(
      `cost: ${report.total.tokensIn} tokens in, ${report.total.tokensOut} out, $${report.total.cost.toFixed(2)}; ` +
        `${PRE_RUN_PROJECTS} projects ≈ $${report.threeProjects.toFixed(2)}`,
    );
    if (!report.complete) {
      console.log(`cost: the project is in ${report.stage}, not closed; the total is partial`);
    }
    if (report.unpriced.length) {
      console.log(`cost: no price in packages/llm/src/prices.ts for ${report.unpriced.join(", ")}`);
    }
    const out = new URL("./out/", import.meta.url);
    await mkdir(out, { recursive: true });
    await writeFile(new URL(`cost-${projectId}.json`, out), `${JSON.stringify(report, null, 2)}\n`);
    return 0;
  } finally {
    await close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => (process.exitCode = code),
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
}
