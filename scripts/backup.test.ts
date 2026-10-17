// Task 6.6, Done when: a restore from backup gives the same curve. The pure parts of backup.ts:
// the curve is route 25's estimate error per project in run order, two curves compare by value,
// and the folder copy leaves out node_modules (the runner installs it again).
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { backupDir, copyFolder, curveOf, sameCurve } from "./backup";
import { preRunChecks } from "./pre-run";

const project = (order: number, estimateError: number | null, lessonsUsed = 0) => ({
  projectId: `P${order}`,
  name: "Clinic booking app",
  order,
  closedAt: null,
  clarityBand: null,
  estimateError,
  questions: 3,
  cardsReopenedPerCR: null,
  lessonsUsed,
  lessons: [],
});

describe("the curve", () => {
  it("is each project's estimate error and lessons used, in run order", () => {
    const metrics = { projects: [project(2, 0.12, 6), project(1, 0.45)], lessons: [] };
    expect(curveOf(metrics)).toEqual([
      { projectId: "P1", order: 1, estimateError: 0.45, lessonsUsed: 0 },
      { projectId: "P2", order: 2, estimateError: 0.12, lessonsUsed: 6 },
    ]);
  });

  it("is the same only when every point is", () => {
    const a = curveOf({ projects: [project(1, 0.45), project(2, 0.12, 6)], lessons: [] });
    const b = curveOf({ projects: [project(1, 0.45), project(2, 0.12, 6)], lessons: [] });
    expect(sameCurve(a, b)).toEqual({ same: true, diff: [] });
    const c = curveOf({ projects: [project(1, 0.45), project(2, 0.2, 6)], lessons: [] });
    expect(sameCurve(a, c)).toEqual({ same: false, diff: ["P2: estimateError 0.12 -> 0.2"] });
    expect(sameCurve(a, a.slice(0, 1))).toEqual({
      same: false,
      diff: ["P2: missing after restore"],
    });
  });
});

describe("copyFolder", () => {
  const root = mkdtempSync(join(tmpdir(), "am-backup-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("copies a folder without node_modules, replacing what the target held", async () => {
    const from = join(root, "from");
    mkdirSync(join(from, "repo", "node_modules", "x"), { recursive: true });
    writeFileSync(join(from, "repo", "app.ts"), "built\n");
    writeFileSync(join(from, "repo", "node_modules", "x", "i.js"), "dep\n");
    const to = join(root, "to");
    mkdirSync(to);
    writeFileSync(join(to, "stale.txt"), "old\n");

    await copyFolder(from, to);
    expect(readFileSync(join(to, "repo", "app.ts"), "utf8")).toBe("built\n");
    expect(existsSync(join(to, "repo", "node_modules"))).toBe(false);
    expect(existsSync(join(to, "stale.txt"))).toBe(false);
  });

  it("skips a folder that does not exist", async () => {
    await expect(copyFolder(join(root, "nothing"), join(root, "out"))).resolves.toBe(false);
  });
});

describe("preRunChecks", () => {
  const point = (order: number, estimateError: number | null, lessonsUsed = 0) => ({
    projectId: `P${order}`,
    order,
    estimateError,
    lessonsUsed,
  });

  it("passes a falling curve whose second project used lessons", () => {
    expect(preRunChecks([point(1, 0.45), point(2, 0.12, 6), point(3, 0.03, 6)])).toEqual([]);
  });

  it("fails a curve that does not fall, and a second project with no lesson", () => {
    expect(preRunChecks([point(1, 0.3), point(2, 0.12), point(3, 0.4, 2)])).toHaveLength(2);
  });
});

describe("backupDir", () => {
  it("keeps a backup inside the backups folder", () => {
    expect(backupDir("pre-run")).toMatch(/agencymem-backups[\\/]pre-run$/);
    for (const bad of ["..", ".", "../x", "a/b", "a\\b", "", undefined]) {
      expect(() => backupDir(bad)).toThrow(/backup name/);
    }
  });
});
