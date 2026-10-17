// `pnpm backup [--name x]` and `pnpm restore <name>` (task 6.6): the demo state, so a failed
// rehearsal can be undone. A backup is ../agencymem-backups/<name>/, outside the repository like
// WORKSPACES_DIR (it holds copies of client code):
//   dump.rdb       FalkorDB's data, saved and copied out of the docker compose container
//   workspaces/    WORKSPACES_DIR, the project repositories (node_modules left out: the runner
//                  installs it again)
//   uploads/       UPLOADS_DIR, the uploaded notes (resolved from apps/gateway, as the gateway does)
//   sim-state/     the simulator's hidden numbers
//   curve.json     route 25's estimate error per project, to check a restore against
// Restore stops FalkorDB (it saves on shutdown, so the copy must come after), copies the data in,
// starts it, puts the folders back and compares route 25 with curve.json. Stop the runner and the
// simulator first; the gateway must run (it serves route 25).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { ConfigSchema, type AgencyMetrics } from "@agencymem/contracts";

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BACKUPS = resolve(ROOT, "../agencymem-backups");

export type Point = {
  projectId: string;
  order: number;
  estimateError: number | null;
  lessonsUsed: number;
};

/** The curve the health panel draws: each project's estimate error, in run order. */
export function curveOf(metrics: AgencyMetrics): Point[] {
  return metrics.projects
    .map((p) => ({
      projectId: p.projectId,
      order: p.order,
      estimateError: p.estimateError,
      lessonsUsed: p.lessonsUsed,
    }))
    .sort((a, b) => a.order - b.order);
}

/** Compares a restored curve with the saved one, point by point. */
export function sameCurve(saved: Point[], restored: Point[]): { same: boolean; diff: string[] } {
  const now = new Map(restored.map((p) => [p.projectId, p]));
  const diff: string[] = [];
  for (const p of saved) {
    const q = now.get(p.projectId);
    if (!q) {
      diff.push(`${p.projectId}: missing after restore`);
      continue;
    }
    for (const key of ["order", "estimateError", "lessonsUsed"] as const) {
      if (p[key] !== q[key]) diff.push(`${p.projectId}: ${key} ${p[key]} -> ${q[key]}`);
    }
    now.delete(p.projectId);
  }
  for (const id of now.keys()) diff.push(`${id}: not in the backup`);
  return { same: diff.length === 0, diff };
}

/** The folder of a backup. A name is letters, digits, `-`, `_` and `.`, so it stays in the backups folder. */
export function backupDir(name: string | undefined): string {
  if (!name || !/^[\w-][\w.-]*$/.test(name)) {
    throw new Error(`A backup name is letters, digits, "-", "_" and "."; got "${name ?? ""}".`);
  }
  return join(BACKUPS, name);
}

/** Replaces `to` with a copy of `from` without node_modules. False when `from` does not exist. */
export async function copyFolder(from: string, to: string): Promise<boolean> {
  if (!existsSync(from)) return false;
  await rm(to, { recursive: true, force: true });
  await cp(from, to, { recursive: true, filter: (src) => basename(src) !== "node_modules" });
  return true;
}

const env = (key: keyof typeof ConfigSchema.shape) =>
  String(ConfigSchema.shape[key].parse(process.env[key]));

/** The folders a backup holds, as the runner, gateway and simulator resolve them. */
const folders = () => ({
  workspaces: resolve(ROOT, env("WORKSPACES_DIR")),
  uploads: resolve(ROOT, "apps/gateway", env("UPLOADS_DIR")),
  "sim-state": join(ROOT, "sim-state"),
});

async function docker(...args: string[]): Promise<string> {
  return (await run("docker", args, { cwd: ROOT })).stdout.trim();
}

/** The docker compose FalkorDB container, and where it keeps dump.rdb. */
async function falkordb(): Promise<{ id: string; file: string }> {
  const id = await docker("compose", "ps", "-a", "-q", "falkordb");
  if (!id) throw new Error("No docker compose falkordb container. Run `docker compose up -d`.");
  const config = async (key: string) => {
    const [, value] = (await docker("exec", id, "redis-cli", "CONFIG", "GET", key)).split("\n");
    if (!value) throw new Error(`FalkorDB did not answer CONFIG GET ${key}.`);
    return value.trim();
  };
  return { id, file: `${await config("dir")}/${await config("dbfilename")}` };
}

async function curve(): Promise<Point[]> {
  const res = await fetch(`${env("GATEWAY_URL")}/api/agency/metrics`, {
    headers: { "X-AM-Token": env("AM_UI_TOKEN") },
  });
  if (!res.ok)
    throw new Error(`GET /api/agency/metrics answered ${res.status}. Is the gateway up?`);
  return curveOf((await res.json()) as AgencyMetrics);
}

export async function backup(name: string): Promise<string> {
  const dir = backupDir(name);
  // Everything that can fail comes first, into a temporary folder: an old backup of the same name
  // is replaced only by a complete new one.
  const saved = await curve();
  const db = await falkordb();
  const tmp = join(BACKUPS, `.${name}.tmp`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  await docker("exec", db.id, "redis-cli", "SAVE");
  await docker("cp", `${db.id}:${db.file}`, join(tmp, "dump.rdb"));
  for (const [key, from] of Object.entries(folders())) {
    const copied = await copyFolder(from, join(tmp, key));
    console.log(`backup: ${key} ${copied ? `copied from ${from}` : `(none at ${from})`}`);
  }
  await writeFile(join(tmp, "curve.json"), `${JSON.stringify(saved, null, 2)}\n`);
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
  console.log(`backup: ${saved.length} projects on the curve; saved to ${dir}`);
  return dir;
}

async function waitFor(what: string, ok: () => Promise<boolean>, ms = 60_000) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await ok().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`restore: ${what} did not come back within ${ms / 1000} s`);
}

export async function restore(name: string): Promise<boolean> {
  const dir = backupDir(name);
  if (!existsSync(join(dir, "dump.rdb"))) throw new Error(`No backup at ${dir}.`);
  console.log("restore: the runner and the simulator must be stopped; the gateway must run");
  const db = await falkordb();
  await docker("compose", "stop", "falkordb");
  try {
    await docker("cp", join(dir, "dump.rdb"), `${db.id}:${db.file}`);
  } finally {
    await docker("compose", "start", "falkordb"); // never leave FalkorDB stopped
  }
  await waitFor(
    "FalkorDB",
    async () => (await docker("exec", db.id, "redis-cli", "PING")) === "PONG",
  );
  for (const [key, to] of Object.entries(folders())) {
    const copied = await copyFolder(join(dir, key), to);
    // A folder the backup did not have is emptied, so no stray files sit next to the graph.
    if (!copied) await rm(to, { recursive: true, force: true });
    console.log(`restore: ${key} ${copied ? `put back at ${to}` : "emptied (not in the backup)"}`);
  }
  // The gateway reconnects to FalkorDB on its own; wait until it reports the graph as up.
  await waitFor("the gateway", async () => (await fetch(`${env("GATEWAY_URL")}/healthz`)).ok);
  const saved = JSON.parse(await readFile(join(dir, "curve.json"), "utf8")) as Point[];
  if (!saved.length) console.log("restore: the saved curve is empty; only the data was put back");
  const { same, diff } = sameCurve(saved, await curve());
  console.log(same ? `restore: SAME curve (${saved.length} projects)` : "restore: DIFFERENT curve");
  for (const line of diff) console.log(`  ${line}`);
  return same;
}

async function main(): Promise<number> {
  const [command, arg] = process.argv.slice(2);
  if (command === "backup") {
    const i = process.argv.indexOf("--name");
    const name = i > 0 ? process.argv[i + 1] : new Date().toISOString().replace(/[:.]/g, "-");
    await backup(name ?? ""); // backupDir refuses a missing or unsafe name
    return 0;
  }
  if (command === "restore" && arg) return (await restore(arg)) ? 0 : 1;
  console.error("usage: pnpm backup [--name <name>] | pnpm restore <name>");
  return 1;
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
