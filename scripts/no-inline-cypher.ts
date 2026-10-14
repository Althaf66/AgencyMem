// Fails when a .ts/.tsx file holds a Cypher string (AGENTS.md rule 4), or when a .cypher file
// outside cypher/write/ or cypher/schema/ holds a write clause (supports rule 3).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Skipped at any depth, and skipped only at the repository root.
const SKIP_ANYWHERE = new Set(["node_modules", "dist", ".git"]);
const SKIP_AT_ROOT = new Set([".claude", "docs", ".gstack"]);

// ponytail: upper-case keywords only, as Cypher is written in practice. A lower-case query in a
// string would slip through; widen the patterns if that ever happens.
const CYPHER_IN_STRING = [
  /\b(?:OPTIONAL MATCH|MATCH|MERGE|CREATE)\s*\(/,
  /\bUNWIND\s+\S+\s+AS\s+\w+/,
  /\bRETURN\s+[\w$*`]/,
  /\bGRAPH\.(?:QUERY|RO_QUERY|EXPLAIN|PROFILE)\b/,
  /\bCREATE\s+(?:INDEX|CONSTRAINT|VECTOR)\b/,
  /\bDETACH\s+DELETE\b/,
  /\bCALL\s+db\./,
];

const WRITE_CLAUSE = /\b(?:CREATE|MERGE|SET|DELETE|REMOVE|DROP)\b/i;

export type Finding = { line: number; text: string };

export function findInlineCypher(source: string, fileName: string): Finding[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found: Finding[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (CYPHER_IN_STRING.some((re) => re.test(node.text))) {
        const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        found.push({ line, text: node.text.trim().slice(0, 60) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** True when the Cypher has a write clause outside comments and string literals. */
export function hasWriteClause(cypher: string): boolean {
  // One pass, so a // inside a string is not read as a comment.
  const code = cypher.replace(
    /\/\*[\s\S]*?\*\/|\/\/.*$|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/gm,
    " ",
  );
  return WRITE_CLAUSE.test(code);
}

function walk(dir: string, atRoot: boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const skip = SKIP_ANYWHERE.has(entry.name) || (atRoot && SKIP_AT_ROOT.has(entry.name));
      if (!skip) walk(join(dir, entry.name), false, out);
    } else {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Returns one message per problem under `root`; empty means the repository is clean. */
export function checkRepo(root: string): string[] {
  const problems: string[] = [];
  for (const path of walk(root, true)) {
    const name = relative(root, path).split("\\").join("/");
    if (/\.tsx?$/.test(name)) {
      for (const f of findInlineCypher(readFileSync(path, "utf8"), name)) {
        problems.push(`${name}:${f.line} Cypher in a TypeScript string: "${f.text}"`);
      }
    } else if (name.endsWith(".cypher")) {
      const allowed = /(^|\/)cypher\/(write|schema)\//.test(name);
      if (!allowed && hasWriteClause(readFileSync(path, "utf8"))) {
        problems.push(`${name}: write clause outside cypher/write/ or cypher/schema/`);
      }
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkRepo(process.cwd());
  if (problems.length > 0) {
    console.error(`no-inline-cypher: ${problems.length} problem(s)\n  ${problems.join("\n  ")}`);
    process.exit(1);
  }
  console.log("no-inline-cypher: ok");
}
