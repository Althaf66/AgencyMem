// The gateway: one Node.js process, Express 5 and a `ws` WebSocket server on one HTTP server. It
// serves /mcp, /api, /ws, /hooks/commit and /healthz.
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import express, { type RequestHandler } from "express";
import { WebSocketServer } from "ws";
import { loadConfig, type Config, type ErrorBody, type HealthResponse } from "@agencymem/contracts";
import { isReachable } from "@agencymem/graph";
import pkg from "../package.json" with { type: "json" };
import { requireToken, tokenMatches } from "./auth";

/** The technical design binds the gateway to 127.0.0.1 by default. */
const HOST = "127.0.0.1";

/** loadConfig(…, "gateway") requires or defaults these, but the Config type leaves them optional.
 * An empty token would let an empty header through, so refuse to start without one. */
function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const notFound: RequestHandler = (_req, res) => {
  const body: ErrorBody = { error: { code: "NOT_FOUND", reason: "No such route." } };
  res.status(404).json(body);
};

export function createGateway(cfg: Config): Server {
  const agent = required(cfg.AM_AGENT_TOKEN, "AM_AGENT_TOKEN");
  const ui = required(cfg.AM_UI_TOKEN, "AM_UI_TOKEN");
  const hook = required(cfg.AM_HOOK_TOKEN, "AM_HOOK_TOKEN");
  const falkordbUrl = required(cfg.FALKORDB_URL, "FALKORDB_URL"); // has a default in config

  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", async (_req, res) => {
    const up = await isReachable(falkordbUrl);
    const body: HealthResponse = { ok: up, falkordb: up ? "up" : "down", version: pkg.version };
    res.status(up ? 200 : 503).json(body);
  });

  // One token check per route group, and each group ends in its own 404, so a request never falls
  // through to another group's check. Later tasks mount their routers between the two.
  // /api/runs (route 30) takes the agent token and is mounted before /api, which takes the UI
  // token. /mcp takes both: session.ts (task 1.6) limits a UI session to read_query.
  app.use("/api/runs", requireToken(agent), notFound);
  app.use("/api", requireToken(ui), notFound);
  app.use("/hooks", requireToken(hook), notFound);
  app.use("/mcp", requireToken(agent, ui), notFound);
  app.use(notFound); // any other path, with the contract's error body

  const server = createServer(app);

  // Browsers cannot set headers on a WebSocket, so the UI token comes as ?token= (contracts.md
  // section 10). Any other path or token is refused before the upgrade.
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !tokenMatches(url.searchParams.get("token") ?? undefined, ui)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    const cfg = loadConfig(process.env, "gateway");
    createGateway(cfg).listen(cfg.AM_PORT, HOST, () => {
      console.log(`gateway listening on http://${HOST}:${cfg.AM_PORT}`);
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
