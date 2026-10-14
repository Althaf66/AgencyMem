import { FalkorDB } from "falkordb";

let db: Promise<FalkorDB> | undefined;

/**
 * The one FalkorDB client of the process.
 * ponytail: one client is the pool; node-redis pipelines commands on one socket. Open several
 * clients if throughput ever needs it.
 */
export function connect(url: string): Promise<FalkorDB> {
  db ??= FalkorDB.connect({ url }).catch((e: unknown) => {
    db = undefined; // let the next call retry
    throw e;
  });
  return db;
}

export async function close(): Promise<void> {
  const current = db;
  db = undefined;
  if (current) await (await current).close();
}
