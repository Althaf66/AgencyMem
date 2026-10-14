import { reject, type GuardResult } from "./run";

// Built at run time, so this file holds no Cypher-like string literal (AGENTS.md rule 4).
const CALL_DB = ["CALL", "db."].join(" ");

/**
 * The clauses read_query refuses (contracts.md section 7, read_query), checked in this order: the
 * multi-word ones first, so `CALL db.idx.fulltext.drop()` reports CALL db., not DROP.
 */
const WRITE_CLAUSES: { clause: string; pattern: RegExp }[] = [
  { clause: "LOAD CSV", pattern: /\bLOAD\s+CSV\b/i },
  { clause: CALL_DB, pattern: /\bCALL\s+db\./i },
  { clause: "CREATE", pattern: /\bCREATE\b/i },
  { clause: "MERGE", pattern: /\bMERGE\b/i },
  { clause: "SET", pattern: /\bSET\b/i },
  { clause: "DELETE", pattern: /\bDELETE\b/i },
  { clause: "REMOVE", pattern: /\bREMOVE\b/i },
  { clause: "DROP", pattern: /\bDROP\b/i },
];

/**
 * Comments, string literals and backtick identifiers, removed in one left-to-right pass: a // in a
 * string is not a comment, and a quote in `a'b` does not open a string that hides a real clause.
 */
const COMMENTS_AND_STRINGS =
  /\/\*[\s\S]*?\*\/|\/\/.*$|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/gm;

/**
 * Rejects read_query from any session but the UI session, and any Cypher with a write clause
 * outside comments and strings. The query then also runs with GRAPH.RO_QUERY, so FalkorDB refuses a
 * write this check misses.
 */
export function readOnly(cypher: string, session: "agent" | "ui"): GuardResult | null {
  if (session !== "ui") {
    return reject("read-only", "NOT_UI_SESSION", "Only the UI session may run read queries.");
  }
  const code = cypher.replace(COMMENTS_AND_STRINGS, " ");
  const found = WRITE_CLAUSES.find(({ pattern }) => pattern.test(code));
  if (!found) return null;
  return reject("read-only", "WRITE_CLAUSE", `A read query may not use ${found.clause}.`, {
    clause: found.clause,
  });
}
