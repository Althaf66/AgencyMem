// The live preview: the project's built app from main, run on a free port so the web client can
// show it in an iframe. One process per project, in its own worktree (<project>/preview, detached
// at main) so the runner's repo is never touched. The app gets a minimal environment: no gateway
// token or model key reaches it.
import { execFile, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";
import type { PreviewView } from "@agencymem/contracts";
import type { Events } from "./events/bus";

const run = promisify(execFile);
const LOG_LINES = 40;
const READY_MS = 180_000;
const WIN = process.platform === "win32";
/** The variables a child needs to find node and npm; nothing else from the gateway's environment. */
const PASS_ENV = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "ComSpec",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
];

type Entry = { view: PreviewView; proc: ChildProcess | null; flush: NodeJS.Timeout | null };

export type Previews = {
  get(projectId: string): PreviewView;
  start(projectId: string, projectDir: string): PreviewView;
  stop(projectId: string): PreviewView;
  stopAll(): void;
};

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });

/** Kills a child and every process it started (npm runs node under a shell on Windows). */
function killTree(proc: ChildProcess) {
  if (proc.pid === undefined || proc.exitCode !== null) return;
  if (WIN) spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-proc.pid, "SIGTERM");
}

/** Every gateway's previews in this process, so the process can stop them all on its way out. */
const ALL = new Set<Previews>();
export const stopAllPreviews = () => ALL.forEach((p) => p.stopAll());

export function createPreviews(deps: { events: Events }): Previews {
  const entries = new Map<string, Entry>();
  const STOPPED: PreviewView = { status: "stopped", url: null, log: [] };

  const entry = (projectId: string): Entry => {
    let e = entries.get(projectId);
    if (!e) entries.set(projectId, (e = { view: STOPPED, proc: null, flush: null }));
    return e;
  };
  const emit = (projectId: string) => {
    const e = entry(projectId);
    if (e.flush) clearTimeout(e.flush);
    e.flush = null;
    deps.events.emit(projectId, "preview.changed", e.view);
  };
  const set = (projectId: string, change: Partial<PreviewView>) => {
    const e = entry(projectId);
    e.view = { ...e.view, ...change };
    emit(projectId);
  };
  /** New output: kept, and sent at most once a second. */
  const log = (projectId: string, text: string) => {
    const e = entry(projectId);
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    e.view = { ...e.view, log: [...e.view.log, ...lines].slice(-LOG_LINES) };
    e.flush ??= setTimeout(() => emit(projectId), 1000);
  };

  async function launch(projectId: string, projectDir: string) {
    const repo = join(projectDir, "repo");
    const dir = join(projectDir, "preview");
    const git = (cwd: string, ...args: string[]) => run("git", args, { cwd });
    try {
      if (!existsSync(join(repo, ".git"))) throw new Error("The project has no repository yet.");
      // The newest main, in the preview's own worktree.
      if (!existsSync(join(dir, ".git")))
        await git(repo, "worktree", "add", "--detach", dir, "main");
      else await git(dir, "checkout", "--detach", "--force", "main");
      const env: Record<string, string> = {};
      for (const k of PASS_ENV) if (process.env[k]) env[k] = process.env[k]!;
      if (entry(projectId).view.status === "stopped") return; // stopped meanwhile
      if (existsSync(join(dir, "package-lock.json")) && !existsSync(join(dir, "node_modules"))) {
        set(projectId, { status: "installing", log: ["npm ci"] });
        const install = await run("npm", ["ci", "--no-audit", "--no-fund", "--prefer-offline"], {
          cwd: dir,
          env,
          shell: WIN,
          maxBuffer: 20 * 1024 * 1024,
        });
        log(projectId, install.stdout.split("\n").slice(-5).join("\n"));
      }
      if (entry(projectId).view.status === "stopped") return; // stopped while installing
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      set(projectId, { status: "starting", url });
      const proc = spawn("npm", ["run", "dev"], {
        cwd: dir,
        env: { ...env, PORT: String(port), NODE_ENV: "development" },
        shell: WIN,
        detached: !WIN,
      });
      entry(projectId).proc = proc;
      proc.stdout?.on("data", (d: Buffer) => log(projectId, d.toString()));
      proc.stderr?.on("data", (d: Buffer) => log(projectId, d.toString()));
      proc.once("exit", (code) => {
        const e = entry(projectId);
        if (e.proc !== proc) return;
        e.proc = null;
        if (e.view.status !== "stopped") set(projectId, { status: "failed", url: null });
        log(projectId, `exited with code ${code ?? "none"}`);
      });
      const until = Date.now() + READY_MS;
      while (Date.now() < until && entry(projectId).proc === proc) {
        const up = await fetch(url).then(
          (r) => r.ok,
          () => false,
        );
        if (up) return set(projectId, { status: "ready" });
        await new Promise((r) => setTimeout(r, 500));
      }
      if (entry(projectId).proc === proc) {
        killTree(proc);
        set(projectId, {
          status: "failed",
          url: null,
          log: [...entry(projectId).view.log, "not ready in time"],
        });
      }
    } catch (e) {
      const reason = e instanceof Error ? e.message.split("\n")[0]! : String(e);
      set(projectId, { status: "failed", url: null, log: [...entry(projectId).view.log, reason] });
    }
  }

  const previews: Previews = {
    get: (projectId) => entry(projectId).view,
    start(projectId, projectDir) {
      const e = entry(projectId);
      if (["installing", "starting", "ready"].includes(e.view.status)) return e.view;
      e.view = { status: "starting", url: null, log: [] };
      emit(projectId);
      void launch(projectId, projectDir);
      return e.view;
    },
    stop(projectId) {
      const e = entry(projectId);
      if (e.proc) killTree(e.proc);
      e.proc = null;
      set(projectId, { status: "stopped", url: null });
      return e.view;
    },
    stopAll() {
      for (const e of entries.values()) if (e.proc) killTree(e.proc);
    },
  };
  ALL.add(previews);
  return previews;
}
