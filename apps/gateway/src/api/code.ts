// The live code view: a card's files and the card's change to each, read with git from the card's
// build worktree (<project>/wt/<KEY>) while it exists, so the screen shows code as OpenCode writes
// it; after the merge, from the merge commit; else from main. Read only.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import express, { type Router } from "express";
import { CardKey, Sha, type CardFileResponse, type CardFilesResponse } from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import { projectDirOf } from "./evidence";
import { pathProject, sendError } from "./http";

const run = promisify(execFile);
const TEXT_MAX = 200_000;
const git = async (cwd: string, ...args: string[]) =>
  (await run("git", ["-c", "core.quotepath=off", ...args], { cwd, maxBuffer: 20 * TEXT_MAX }))
    .stdout;

type Where =
  | { source: "worktree"; dir: string }
  | { source: "merge"; dir: string; sha: string }
  | { source: "main"; dir: string }
  | { source: "none" };

/** Where a card's code is now. `merged` is the card's merge sha, when the screen knows it. */
export function whereIs(projectDir: string, key: string, merged: string | undefined): Where {
  const wt = join(projectDir, "wt", key);
  if (existsSync(join(wt, ".git"))) return { source: "worktree", dir: wt };
  const repo = join(projectDir, "repo");
  if (!existsSync(join(repo, ".git"))) return { source: "none" };
  return merged ? { source: "merge", dir: repo, sha: merged } : { source: "main", dir: repo };
}

/** `git diff --name-status` lines as path to change; a rename counts as its new path, added. */
export function changesOf(
  nameStatus: string,
): Map<string, CardFilesResponse["files"][number]["change"]> {
  const out = new Map<string, CardFilesResponse["files"][number]["change"]>();
  for (const line of nameStatus.split("\n")) {
    const [status = "", ...paths] = line.split("\t");
    const path = paths.at(-1);
    if (!path) continue;
    out.set(
      path,
      status.startsWith("D") ? "deleted" : status.startsWith("M") ? "modified" : "added",
    );
  }
  return out;
}

/** A repo-relative path that stays inside the tree: no absolute path, no `..`, no `.git`. */
export function safePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw) return null;
  const path = raw.replaceAll("\\", "/");
  const parts = path.split("/");
  if (path.startsWith("/") || /^[a-z]:/i.test(path)) return null;
  if (parts.some((p) => p === ".." || p === ".git" || p === "")) return null;
  return path;
}

const lines = (text: string) => text.split("\n").filter(Boolean);
const mergeBase = async (dir: string) => (await git(dir, "merge-base", "main", "HEAD")).trim();

export function codeRouter(deps: { db: () => Promise<FalkorDB>; workspacesDir: string }): Router {
  const router = express.Router();

  /** The project and the card's (or main's) code location, or the rejection to send. */
  async function locate(id: string, rawKey: string, rawMerged: unknown) {
    const found = await pathProject(await deps.db(), id);
    if (!found.ok) return found;
    const projectDir = projectDirOf(deps.workspacesDir, found.id);
    // `main` is the finished code: the repo's main branch, no card's change marked.
    if (rawKey === "main") {
      const repo = join(projectDir, "repo");
      const where: Where = existsSync(join(repo, ".git"))
        ? { source: "main", dir: repo }
        : { source: "none" };
      return { ok: true as const, where };
    }
    const key = CardKey.safeParse(rawKey);
    const merged = rawMerged === undefined ? undefined : Sha.safeParse(rawMerged);
    if (!key.success || (merged && !merged.success)) {
      return {
        ok: false as const,
        error: { code: "VALIDATION_FAILED" as const, reason: "Bad card key or merge sha." },
      };
    }
    return { ok: true as const, where: whereIs(projectDir, key.data, merged?.data) };
  }

  router.get("/projects/:id/cards/:key/files", async (req, res) => {
    const at = await locate(req.params.id, req.params.key, req.query.merged);
    if (!at.ok) return sendError(res, at.error);
    const { where } = at;
    let body: CardFilesResponse = { source: where.source, files: [] };
    try {
      if (where.source === "worktree") {
        const base = await mergeBase(where.dir);
        const tracked = lines(await git(where.dir, "ls-files"));
        const untracked = lines(await git(where.dir, "ls-files", "--others", "--exclude-standard"));
        const changes = changesOf(await git(where.dir, "diff", "--name-status", base));
        for (const p of untracked) changes.set(p, "added");
        const all = new Set([...tracked, ...untracked, ...changes.keys()]);
        body.files = [...all].sort().map((path) => ({ path, change: changes.get(path) ?? null }));
      } else if (where.source !== "none") {
        const ref = where.source === "merge" ? where.sha : "main";
        const changes =
          where.source === "merge"
            ? changesOf(await git(where.dir, "diff", "--name-status", `${ref}^1`, ref))
            : new Map();
        const tree = lines(await git(where.dir, "ls-tree", "-r", "--name-only", ref));
        body.files = tree.map((path) => ({ path, change: changes.get(path) ?? null }));
      }
    } catch {
      body = { source: "none", files: [] }; // a sha the repo does not hold, or no main yet
    }
    res.json(body);
  });

  router.get("/projects/:id/cards/:key/file", async (req, res) => {
    const at = await locate(req.params.id, req.params.key, req.query.merged);
    if (!at.ok) return sendError(res, at.error);
    const path = safePath(req.query.path);
    if (!path) return sendError(res, { code: "VALIDATION_FAILED", reason: "Bad file path." });
    const { where } = at;
    if (where.source === "none") {
      return sendError(res, { code: "NOT_FOUND", reason: "The card has no code yet." });
    }
    let text = "";
    let diff = "";
    try {
      if (where.source === "worktree") {
        const abs = resolve(where.dir, path);
        if (!abs.startsWith(where.dir + sep)) {
          return sendError(res, { code: "VALIDATION_FAILED", reason: "Bad file path." });
        }
        if (existsSync(abs)) text = await readFile(abs, "utf8");
        diff = await git(where.dir, "diff", await mergeBase(where.dir), "--", path);
      } else {
        const ref = where.source === "merge" ? where.sha : "main";
        text = await git(where.dir, "show", `${ref}:${path}`).catch(() => "");
        if (where.source === "merge")
          diff = await git(where.dir, "diff", `${ref}^1`, ref, "--", path);
      }
    } catch {
      return sendError(res, { code: "NOT_FOUND", reason: `Cannot read ${path}.` });
    }
    const body: CardFileResponse = {
      path,
      text: text.slice(0, TEXT_MAX),
      diff: diff.slice(0, TEXT_MAX),
      truncated: text.length > TEXT_MAX || diff.length > TEXT_MAX,
    };
    res.json(body);
  });

  return router;
}
