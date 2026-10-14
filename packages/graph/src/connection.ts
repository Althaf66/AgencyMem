import { FalkorDB } from "falkordb";

const clients = new Map<string, Promise<FalkorDB>>();

/**
 * The FalkorDB client for a URL, one per URL per process.
 * ponytail: one client is the pool; node-redis pipelines commands on one socket. Open several
 * clients if throughput ever needs it.
 */
export function connect(url: string): Promise<FalkorDB> {
  let client = clients.get(url);
  if (!client) {
    client = FalkorDB.connect({ url })
      // A lost socket is emitted as 'error'. Without a listener it crashes the process and the
      // client stops reconnecting. node-redis reconnects by itself; /healthz reports the outage.
      // Nothing is logged: the URL can carry a password.
      .then((db) => db.on("error", () => undefined))
      .catch((e: unknown) => {
        clients.delete(url); // let the next call retry
        throw e;
      });
    clients.set(url, client);
  }
  return client;
}

/** Closes every client this process opened. */
export async function close(): Promise<void> {
  const open = [...clients.values()];
  clients.clear();
  await Promise.allSettled(open.map(async (client) => (await client).close()));
}

/**
 * True when FalkorDB answers within `timeoutMs`. A server that went down makes commands wait for
 * a reconnect, so the timeout turns that wait into "down".
 */
export async function isReachable(url: string, timeoutMs = 1000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    await Promise.race([connect(url).then((db) => db.list()), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
