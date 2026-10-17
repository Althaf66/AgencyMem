// `pnpm pre-run` (task 6.6, implementation plan "Pre-run"): on an empty graph, runs `pnpm sim:run`
// (at most 3 projects, sets A, B, C, with SIM_SEED), checks the curve, then backs everything up as
// the pre-run backup (pnpm restore pre-run). Needs the gateway and the runner running; spends model money and takes long.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ConfigSchema, type ProjectInfo } from "@agencymem/contracts";
import { backup, curveOf, type Point } from "./backup";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The plan's two checks: the last project's error is lower than the first's; project 2 reused lessons. */
export function preRunChecks(curve: Point[]): string[] {
  const failed: string[] = [];
  const first = curve[0]?.estimateError;
  const last = curve.at(-1)?.estimateError;
  if (curve.length < 2 || first == null || last == null || !(last < first)) {
    failed.push(
      `the estimate error should fall from the first project to the last (${first} -> ${last})`,
    );
  }
  if (!curve[1] || curve[1].lessonsUsed === 0) {
    failed.push("project 2 should use a lesson from project 1");
  }
  return failed;
}

async function main(): Promise<number> {
  const gateway = ConfigSchema.shape.GATEWAY_URL.parse(process.env.GATEWAY_URL);
  const token = String(ConfigSchema.shape.AM_UI_TOKEN.parse(process.env.AM_UI_TOKEN));
  const get = async <T>(path: string) => {
    const res = await fetch(`${gateway}${path}`, { headers: { "X-AM-Token": token } });
    if (!res.ok) throw new Error(`GET ${path} answered ${res.status}. Is the gateway up?`);
    return (await res.json()) as T;
  };
  const count = ConfigSchema.shape.SIM_PROJECTS.parse(process.env.SIM_PROJECTS);
  if (count > 3) {
    console.error(`pre-run: SIM_PROJECTS is ${count}; the pre-run is at most 3 projects.`);
    return 1;
  }

  // The health panel draws every project in the registry, so the pre-run starts from none.
  const { projects } = await get<{ projects: ProjectInfo[] }>("/api/projects");
  if (projects.length) {
    console.error(
      `pre-run: the graph already holds ${projects.length} projects. Back them up (pnpm backup), ` +
        "start from an empty FalkorDB and run `pnpm seed` first.",
    );
    return 1;
  }
  const seed = ConfigSchema.shape.SIM_SEED.parse(process.env.SIM_SEED);
  console.log(`pre-run: SIM_SEED ${seed}, ${count} projects`);
  const sim = spawnSync("pnpm", ["sim:run"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (sim.status !== 0) return 1;

  const curve = curveOf(await get("/api/agency/metrics"));
  console.table(curve);
  const failed = preRunChecks(curve);
  for (const line of failed) console.log(`pre-run: check failed: ${line}`);
  // A run that fails its checks never replaces a good pre-run backup.
  await backup(failed.length ? "pre-run-failed" : "pre-run");
  return failed.length ? 1 : 0;
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
