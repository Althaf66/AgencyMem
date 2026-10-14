// Live events over /ws (contracts.md section 10). A client subscribes to a project with the seq of
// the snapshot it holds; it gets the events it missed (or a reset), then every new event.
import type { WebSocket, WebSocketServer } from "ws";
import { SubscribeMessage, type Rejection, type ServerMessage } from "@agencymem/contracts";
import { REGISTRY_GRAPH, readQuery, type FalkorDB } from "@agencymem/graph";
import type { Events } from "./bus";

export const PING_MS = 30_000;

/** Serves subscriptions on `wss`. Returns a function that stops the pings and the forwarding. */
export function attachEventSocket(
  wss: WebSocketServer,
  deps: { events: Events; db: () => Promise<FalkorDB> },
): () => void {
  const subscriptions = new Map<WebSocket, Set<string>>();
  const alive = new Map<WebSocket, boolean>();

  const send = (ws: WebSocket, message: ServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const fail = (ws: WebSocket, error: Rejection) => send(ws, { type: "error", error });

  const stopForwarding = deps.events.on((event) => {
    for (const [ws, projects] of subscriptions) {
      if (projects.has(event.projectId)) send(ws, { type: "event", event });
    }
  });

  wss.on("connection", (ws) => {
    subscriptions.set(ws, new Set());
    alive.set(ws, true);
    // A bad frame (unknown opcode, bad UTF-8, too large) is emitted as 'error'. Without a
    // listener it would crash the gateway; close that one socket instead.
    ws.on("error", () => ws.terminate());
    ws.on("pong", () => alive.set(ws, true));
    ws.on("close", () => {
      subscriptions.delete(ws);
      alive.delete(ws);
    });

    ws.on("message", async (raw) => {
      let body: unknown;
      try {
        body = JSON.parse(String(raw));
      } catch {
        return fail(ws, { code: "VALIDATION_FAILED", reason: "A message must be JSON." });
      }
      const message = SubscribeMessage.safeParse(body);
      if (!message.success) {
        return fail(ws, {
          code: "VALIDATION_FAILED",
          reason: 'Send { "type": "subscribe", "projectId": "...", "since"?: seq }.',
        });
      }
      const { projectId, since } = message.data;

      let known: boolean;
      try {
        const rows = await readQuery(await deps.db(), REGISTRY_GRAPH, "read/project", {
          projectId,
        });
        known = rows.length > 0;
      } catch {
        return fail(ws, { code: "GRAPH_UNAVAILABLE", reason: "FalkorDB is not reachable." });
      }
      if (!known) return fail(ws, { code: "NOT_FOUND", reason: `Unknown project ${projectId}.` });

      // From here on everything is synchronous, so no event can slip in between the replay and
      // the subscription: the client sees every seq once, in order.
      if (since !== undefined) {
        const replay = deps.events.replay(projectId, since);
        if (replay === "reset") {
          send(ws, { type: "reset", projectId, seq: deps.events.current(projectId) });
        } else {
          for (const event of replay) send(ws, { type: "event", event });
        }
      }
      subscriptions.get(ws)?.add(projectId);
    });
  });

  // A ping every 30 seconds; a socket that did not answer the last one is closed.
  const ping = setInterval(() => {
    for (const ws of wss.clients) {
      if (alive.get(ws) === false) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, PING_MS);
  ping.unref();

  return () => {
    clearInterval(ping);
    stopForwarding();
  };
}
