import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("root scripts", () => {
  it.each([
    "dev",
    "build",
    "lint",
    "typecheck",
    "test",
    "seed",
    "sim:run",
    "test:load",
    "test:restart",
    "test:isolation",
    "eval:discovery",
  ])("has %s", (name) => {
    expect(pkg.scripts[name]).toBeTruthy();
  });

  it.each([
    ["seed", "1.3"],
    ["sim:run", "5.5"],
    ["test:load", "6.1"],
    ["test:restart", "6.2"],
    ["test:isolation", "6.3"],
    ["eval:discovery", "6.4"],
  ])("stub %s names the task that replaces it (%s)", (name, task) => {
    const cmd = pkg.scripts[name] ?? "";
    expect(cmd).toMatch(/^tsx scripts\/stub\.ts /);
    const run = spawnSync("pnpm", ["exec", ...cmd.split(" ")], { encoding: "utf8", shell: true });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`not implemented until task ${task}`);
  });
});
