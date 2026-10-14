import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cruise, type ICruiseResult, type IForbiddenRuleType } from "dependency-cruiser";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const config = createRequire(import.meta.url)("../.dependency-cruiser.cjs") as {
  forbidden: IForbiddenRuleType[];
  options: Record<string, unknown>;
};

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "am-depcruise-"));
  mkdirSync(join(root, "apps"));
  mkdirSync(join(root, "packages"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content = "export const x = 1;\n") {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A workspace package that apps import by name, linked the way pnpm links it. */
function workspacePackage(dir: string, name: string) {
  write(`${dir}/package.json`, JSON.stringify({ name, exports: { ".": "./src/index.ts" } }));
  write(`${dir}/src/index.ts`);
  mkdirSync(join(root, "node_modules", "@agencymem"), { recursive: true });
  symlinkSync(join(root, dir), join(root, "node_modules", name), "junction");
}

async function violations(): Promise<string[]> {
  const result = await cruise(
    ["apps", "packages"],
    { ...config.options, ruleSet: { forbidden: config.forbidden }, validate: true, baseDir: root },
    { symlinks: true },
  );
  const output = result.output as ICruiseResult;
  return output.summary.violations.map((v) => `${v.rule.name}: ${v.from} -> ${v.to}`);
}

function expectRule(found: string[], rule: string) {
  expect(found.some((v) => v.startsWith(`${rule}:`))).toBe(true);
}

describe("import rules", () => {
  it("fails when runner imports memory by relative path", async () => {
    write("packages/memory/src/index.ts");
    write(
      "apps/runner/src/bad.ts",
      'import { x } from "../../../packages/memory/src/index";\nexport { x };\n',
    );
    expectRule(await violations(), "runner-only-contracts-llm");
  });

  it("fails when runner imports memory by package name", async () => {
    workspacePackage("packages/memory", "@agencymem/memory");
    write("apps/runner/src/bad.ts", 'import { x } from "@agencymem/memory";\nexport { x };\n');
    expectRule(await violations(), "runner-only-contracts-llm");
  });

  it("lets runner import contracts and llm", async () => {
    workspacePackage("packages/contracts", "@agencymem/contracts");
    workspacePackage("packages/llm", "@agencymem/llm");
    write(
      "apps/runner/src/ok.ts",
      'import { x } from "@agencymem/contracts";\nimport { x as y } from "@agencymem/llm";\nexport { x, y };\n',
    );
    expect(await violations()).toEqual([]);
  });

  it("fails when web imports anything but contracts", async () => {
    workspacePackage("packages/llm", "@agencymem/llm");
    write("apps/web/src/bad.ts", 'import { x } from "@agencymem/llm";\nexport { x };\n');
    expectRule(await violations(), "web-only-contracts");
  });

  it("fails when simulator imports graph", async () => {
    workspacePackage("packages/graph", "@agencymem/graph");
    write("apps/simulator/src/bad.ts", 'import { x } from "@agencymem/graph";\nexport { x };\n');
    expectRule(await violations(), "simulator-only-contracts-llm");
  });

  it("fails when the gateway imports the write entry of graph", async () => {
    write("packages/graph/src/write.ts");
    write(
      "apps/gateway/src/bad.ts",
      'import { x } from "../../../packages/graph/src/write";\nexport { x };\n',
    );
    expectRule(await violations(), "write-cypher-only-in-memory");
  });

  it("lets memory import the write entry of graph", async () => {
    write("packages/graph/src/write.ts");
    write(
      "packages/memory/src/ok.ts",
      'import { x } from "../../graph/src/write";\nexport { x };\n',
    );
    expect(await violations()).toEqual([]);
  });

  it("fails when a package imports a package later in the dependency order", async () => {
    write("packages/memory/src/index.ts");
    write(
      "packages/contracts/src/bad.ts",
      'import { x } from "../../memory/src/index";\nexport { x };\n',
    );
    expectRule(await violations(), "contracts-imports-no-workspace-code");
  });
});
