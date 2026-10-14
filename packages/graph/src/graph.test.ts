// Runs against the real FalkorDB from docker-compose.yml. No mocks.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FalkorDB } from "falkordb";
import {
  UnknownProjectError,
  clientGraphName,
  close,
  connect,
  graphFor,
  listQueries,
  readQuery,
} from "./index";

const URL_ = process.env.FALKORDB_URL ?? "redis://localhost:6380";
const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
let db: FalkorDB;

beforeAll(async () => {
  try {
    db = await connect(URL_);
  } catch (e) {
    throw new Error(`FalkorDB is not reachable at ${URL_}. Run \`docker compose up -d\`.`, {
      cause: e,
    });
  }
});
afterAll(close);

/** Every .cypher file under packages/graph/cypher, found independently of the loader. */
function cypherFilesOnDisk(): string[] {
  const root = fileURLToPath(new URL("../cypher", import.meta.url));
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".cypher"))
    .map((f) => f.replaceAll("\\", "/").replace(/\.cypher$/, ""))
    .sort();
}

describe("cypher loader", () => {
  it("lists every .cypher file", () => {
    const onDisk = cypherFilesOnDisk();
    expect(onDisk.length).toBeGreaterThan(0);
    expect(listQueries()).toEqual(onDisk);
  });

  it("reads a graph that does not exist yet as empty", async () => {
    const rows = await readQuery(db, `client_${ULID}_never_written`, "read/project-graph", {
      projectId: ULID,
    });
    expect(rows).toEqual([]);
  });

  it("runs only read queries on the read path", async () => {
    await expect(readQuery(db, "registry", "write/anything", {})).rejects.toThrow(/read\//);
    await expect(readQuery(db, "registry", "read/missing", {})).rejects.toThrow(/unknown query/i);
  });
});

describe("router", () => {
  it("names a client graph client_<clientId>", () => {
    expect(clientGraphName(ULID)).toBe(`client_${ULID}`);
  });

  it("throws for an unknown project id", async () => {
    await expect(graphFor(db, ULID)).rejects.toBeInstanceOf(UnknownProjectError);
  });
});
