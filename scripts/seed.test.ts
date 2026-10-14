// Runs against the real FalkorDB from docker-compose.yml. No mocks.
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  AGENCY_GRAPH,
  REGISTRY_GRAPH,
  close,
  connect,
  readQuery,
  type FalkorDB,
} from "@agencymem/graph";
import { seed } from "./seed";

const URL_ = process.env.FALKORDB_URL ?? "redis://localhost:6380";
let db: FalkorDB;

beforeAll(async () => {
  db = await connect(URL_);
});
afterAll(close);

async function indexes(graph: string): Promise<Record<string, string[]>> {
  const rows = await readQuery<{ label: string; properties: string[] }>(
    db,
    graph,
    "read/indexes",
    {},
  );
  return Object.fromEntries(rows.map((r) => [r.label, [...r.properties].sort()]));
}

it("creates the registry and agency graphs and can run twice", async () => {
  await seed(db);
  await seed(db);

  expect(await db.list()).toEqual(expect.arrayContaining([REGISTRY_GRAPH, AGENCY_GRAPH]));
  expect(await indexes(REGISTRY_GRAPH)).toEqual({ Client: ["id"], Project: ["id"] });
  expect(await indexes(AGENCY_GRAPH)).toEqual({
    EstimateRecord: ["id"],
    Lesson: ["clarityBand", "featureKind", "id"],
    CaseStudy: ["id"],
  });
});
