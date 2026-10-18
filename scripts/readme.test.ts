// Task 6.7, Done when: every item on the submission checklist is present (implementation plan,
// "Submission checklist"). The README's Cypher list is the generated one, so it names every
// .cypher file with a working link; the other items are checked by their sections and words.
// The public repository and the recorded video itself are checked by hand.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EdgeType, Stage } from "@agencymem/contracts";
import { cypherBlock, readmeBlock } from "./list-cypher";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const cypherFiles = (
  readdirSync(join(ROOT, "packages/graph/cypher"), { recursive: true }) as string[]
).filter((f) => f.endsWith(".cypher"));

/** The text of a `## ` section whose title matches. */
const section = (title: RegExp) => {
  const parts = readme.split(/^## /m);
  const found = parts.find((p) => title.test(p.split("\n")[0]!));
  return found ?? "";
};

describe("the README's Cypher list", () => {
  it("is the generated list, so it is current", () => {
    expect(readmeBlock(readme)).toBe(cypherBlock());
  });

  it("names every .cypher file, each link pointing at a real file", () => {
    const links = [
      ...readmeBlock(readme).matchAll(/\]\((packages\/graph\/cypher\/[^)]+\.cypher)\)/g),
    ].map((m) => m[1]!);
    expect(new Set(links).size).toBe(cypherFiles.length);
    for (const link of links) expect(existsSync(join(ROOT, link))).toBe(true);
  });

  it("puts the six queries that carry the product first", () => {
    const block = readmeBlock(readme);
    for (const name of [
      "claim-task",
      "write-versioned",
      "supersede-fact",
      "impact",
      "why",
      "evidence",
    ]) {
      expect(block.indexOf(`/${name}.cypher)`)).toBeLessThan(block.indexOf("### Schema"));
    }
  });
});

describe("the README's links", () => {
  it("point at files that exist and are published (not git-ignored, like docs/)", () => {
    const links = [...readme.matchAll(/\]\(([^)#:]+)(?:#[^)]*)?\)/g)].map((m) => m[1]!);
    const check = spawnSync("git", ["check-ignore", "--stdin"], {
      cwd: ROOT,
      input: links.join("\n"),
      encoding: "utf8",
    });
    expect(check.status).toBe(1); // 1: none ignored; 0: some ignored; 128: git failed
    expect(links.filter((l) => !existsSync(join(ROOT, l)))).toEqual([]);
    expect(check.stdout.trim()).toBe("");
  });
});

describe("Done when: every item on the submission checklist is present", () => {
  it("has setup steps and the graph data model", () => {
    const setup = section(/^Setup/);
    for (const step of [
      "pnpm i",
      "docker compose up -d",
      "pnpm seed",
      "pnpm dev",
      ".env.example",
    ]) {
      expect(setup).toContain(step);
    }
    const model = section(/^Graph model/);
    for (const word of [
      "registry",
      "client_<clientId>",
      "agency",
      "SOURCED_FROM",
      "SUPERSEDES",
      "validTo",
    ]) {
      expect(model).toContain(word);
    }
    // Every edge the contracts define is a row of the edge table, and every stage is named.
    for (const edge of EdgeType.options) expect(model).toMatch(new RegExp(`\\| ${edge} +\\|`));
    for (const stage of Stage.options) expect(section(/^Architecture/)).toContain(stage);
  });

  it("has a demo video section", () => {
    expect(section(/^Demo video/)).not.toBe("");
  });

  it("has complete local setup steps (no live deployment)", () => {
    expect(section(/^Setup/)).toMatch(/WORKSPACES_DIR/);
    expect(section(/^Setup/)).toMatch(/opencode-ai@1\.18\.32/);
  });

  it("names Track 02 and Track 03", () => {
    expect(readme).toContain("Track 02 (Agent Memory and Coordination)");
    expect(readme).toContain("Track 03 (Company Brain)");
  });

  it("discloses the AI coding tools used to build AgencyMem", () => {
    const disclosure = section(/^AI tool disclosure/);
    expect(disclosure).toContain("Claude Code");
    expect(disclosure).toContain("OpenCode");
  });

  it("says all demo data is synthetic", () => {
    expect(section(/^Synthetic data/)).toMatch(/synthetic/i);
  });

  it("shows FalkorDB is central", () => {
    expect(section(/^Why FalkorDB is central/)).toMatch(/board.*documents.*guards.*traces/s);
  });

  it("says how the agents remember, and that the lessons loop is future work", () => {
    const memory = section(/^How AgencyMem remembers/);
    for (const word of ["Episodic", "Semantic", "Procedural", "Conversation history", "Handoffs"]) {
      expect(memory).toContain(word);
    }
    expect(section(/^Future work/)).toContain("Curator");
  });
});
