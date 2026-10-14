import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkRepo, findInlineCypher, hasWriteClause } from "./no-inline-cypher";

// Built at run time so this test file holds no Cypher string itself.
const read = ["MATCH", "(n:Task)", "RETURN", "n"].join(" ");
const write = ["MERGE", "(n:Task {id: $id})", "SET", "n.x = 1"].join(" ");

describe("findInlineCypher", () => {
  it("flags a string literal", () => {
    const found = findInlineCypher(`const q = ${JSON.stringify(read)};\n`, "a.ts");
    expect(found).toHaveLength(1);
    expect(found[0]?.line).toBe(1);
  });

  it("flags a template literal with an interpolation", () => {
    const found = findInlineCypher(`const q = \`${read} \${x}\`;\n`, "a.ts");
    expect(found).toHaveLength(1);
  });

  it("flags a raw FalkorDB command", () => {
    const cmd = ["GRAPH", "QUERY"].join(".");
    expect(findInlineCypher(`send("${cmd}", g, q);\n`, "a.ts")).toHaveLength(1);
  });

  it.each([
    ["CREATE", "INDEX FOR (n:A) ON (n.id)"],
    ["DETACH", "DELETE n"],
    ["CALL", "db.idx.fulltext.createNodeIndex('A', 'name')"],
  ])("flags %s %s", (a, b) => {
    expect(findInlineCypher(`const q = ${JSON.stringify(`${a} ${b}`)};\n`, "a.ts")).toHaveLength(1);
  });

  it("ignores Cypher inside a comment", () => {
    expect(findInlineCypher(`// ${read}\n/* ${write} */\nexport {};\n`, "a.ts")).toEqual([]);
  });

  it("ignores ordinary strings and code", () => {
    const src = 'const a = "return the match (if any)";\nexport const b = a.length;\n';
    expect(findInlineCypher(src, "a.ts")).toEqual([]);
  });
});

describe("hasWriteClause", () => {
  it("detects a write clause", () => {
    expect(hasWriteClause(write)).toBe(true);
  });
  it("lets a read query pass", () => {
    expect(hasWriteClause(read)).toBe(false);
  });
  it("sees a write clause after a string that holds //", () => {
    expect(hasWriteClause(`${read} WHERE n.u = 'http://x' SET n.a = 1`)).toBe(true);
  });
  it("ignores a write word in a comment or a string", () => {
    expect(hasWriteClause(`// MERGE nothing\n${read} // SET\nWHERE n.k = 'DELETE'`)).toBe(false);
  });
});

describe("checkRepo", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "am-cypher-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function put(path: string, content: string) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  it("passes a clean repo", () => {
    put("apps/gateway/src/a.ts", "export const a = 1;\n");
    put("packages/graph/cypher/read/x.cypher", read);
    put("packages/graph/cypher/write/y.cypher", write);
    expect(checkRepo(root)).toEqual([]);
  });

  it("fails a TypeScript file with Cypher", () => {
    put("apps/gateway/src/a.ts", `export const q = ${JSON.stringify(read)};\n`);
    const found = checkRepo(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("apps/gateway/src/a.ts:1");
  });

  it("fails a write clause in a read folder", () => {
    put("packages/graph/cypher/read/x.cypher", write);
    const found = checkRepo(root);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain("packages/graph/cypher/read/x.cypher");
  });

  it("scans a nested docs folder but skips the root docs folder", () => {
    put("docs/a.ts", `export const q = ${JSON.stringify(read)};\n`);
    expect(checkRepo(root)).toEqual([]);
    put("apps/web/src/docs/a.ts", `export const q = ${JSON.stringify(read)};\n`);
    expect(checkRepo(root)).toHaveLength(1);
  });

  it("skips node_modules and dist", () => {
    put("node_modules/p/a.ts", `export const q = ${JSON.stringify(read)};\n`);
    put("apps/web/dist/a.ts", `export const q = ${JSON.stringify(read)};\n`);
    expect(checkRepo(root)).toEqual([]);
  });
});
