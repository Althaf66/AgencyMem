// Runs against the real FalkorDB from docker-compose.yml. No mocks.
import { afterAll, beforeAll, expect, it } from "vitest";
import { nodeSchemas } from "@agencymem/contracts";
import { close, connect, readQuery, type FalkorDB } from "@agencymem/graph";
import { applySchema } from "./index";

const URL_ = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const GRAPH = `client_test_${process.pid}_${Date.now()}`;
const NOT_IN_CLIENT_GRAPH = ["Client", "Project", "EstimateRecord", "Lesson", "CaseStudy"];
let db: FalkorDB;

beforeAll(async () => {
  db = await connect(URL_);
});
afterAll(async () => {
  await db.selectGraph(GRAPH).delete();
  await close();
});

it("indexes every client label on id, plus the extra indexes, and can run twice", async () => {
  await applySchema(db, GRAPH, "client");
  await applySchema(db, GRAPH, "client");

  const rows = await readQuery<{ label: string; properties: string[] }>(
    db,
    GRAPH,
    "read/indexes",
    {},
  );
  const actual = Object.fromEntries(rows.map((r) => [r.label, [...r.properties].sort()]));

  const expected: Record<string, string[]> = Object.fromEntries(
    Object.keys(nodeSchemas)
      .filter((label) => !NOT_IN_CLIENT_GRAPH.includes(label))
      .map((label) => [label, ["id"]]),
  );
  // Technical design "Indexes" and contracts.md section 4 "Extra indexes".
  expected.Fact = ["attribute", "id", "subject"];
  expected.Task = ["column", "id", "key"];
  expected.Episode = ["documentId", "id"];
  expected.CodeChange = ["id", "sha"];
  expected.WorkItem = ["id", "kind", "status"];
  expected.Requirement = ["id", "key"];
  expected.Feature = ["id", "key"];

  expect(actual).toEqual(expected);
});
