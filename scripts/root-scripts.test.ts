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
});
