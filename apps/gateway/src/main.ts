// The gateway: one Node.js process, Express 5 and a `ws` WebSocket server on one HTTP server. It
// serves /mcp, /api, /ws, /hooks/commit and /healthz.
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { WebSocketServer } from "ws";
import { loadConfig, type Config, type ErrorBody, type HealthResponse } from "@agencymem/contracts";
import { connect, isReachable } from "@agencymem/graph";
import pkg from "../package.json" with { type: "json" };
import { projectsRouter } from "./api/projects";
import { queryRouter } from "./api/query";
import { requireToken, tokenMatches } from "./auth";
import { createEvents, type Events } from "./events/bus";
import { startLeaseSweeper } from "./events/sweeper";
import { attachEventSocket } from "./events/ws";
import { mcpRouter } from "./mcp/server";

/** The technical design binds the gateway to 127.0.0.1 by default. */
const HOST = "127.0.0.1";

/** loadConfig(…, "gateway") requires or defaults these, but the Config type leaves them optional.
 * An empty token would let an empty header through, so refuse to start without one. */
function required<T extends string | number>(value: T | undefined, name: string): T {
  if (value === undefined || value === "") throw new Error(`${name} is required`);
  return value;
}

const notFound: RequestHandler = (_req, res) => {
  const body: ErrorBody = { error: { code: "NOT_FOUND", reason: "No such route." } };
  res.status(404).json(body);
};

/**
 * Last in the chain: every error answers with the contract's `{ error: Rejection }` as JSON, never
 * Express's HTML page with a stack trace. A client error from body parsing (bad JSON, over the size
 * limit) is VALIDATION_FAILED, 400: the contracts' status table has no 413. FalkorDB down is
 * GRAPH_UNAVAILABLE, 503; anything else is INTERNAL, 500.
 */
function onError(isUp: () => Promise<boolean>): ErrorRequestHandler {
  return async (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const clientError = typeof err?.status === "number" && err.status >= 400 && err.status < 500;
    if (clientError) {
      const body: ErrorBody = {
        error: {
          code: "VALIDATION_FAILED",
          reason: "The request body is not valid JSON or is too large.",
        },
      };
      return res.status(400).json(body);
    }
    if (!(await isUp())) {
      const body: ErrorBody = {
        error: { code: "GRAPH_UNAVAILABLE", reason: "FalkorDB is not reachable." },
      };
      return res.status(503).json(body);
    }
    console.error(`gateway: ${err instanceof Error ? err.message : String(err)}`);
    const body: ErrorBody = { error: { code: "INTERNAL", reason: "Internal error." } };
    res.status(500).json(body);
  };
}

/** `opts.events` lets a test listen to the bus; the gateway makes its own otherwise. */
export function createGateway(cfg: Config, opts: { events?: Events } = {}): Server {
  const events = opts.events ?? createEvents();
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
  const db = () => connect(falkordbUrl);
  const isUp = () => isReachable(falkordbUrl);

  app.use("/api/runs", requireToken(agent), notFound);
  app.use(
    "/api",
    requireToken(ui),
    express.json(),
    projectsRouter({ db, events }),
    queryRouter({ db, events }),
    notFound,
  );
  app.use("/hooks", requireToken(hook), notFound);
  const mcp = mcpRouter({
    agentToken: agent,
    db,
    isUp,
    events,
    leaseMs: required(cfg.LEASE_MS, "LEASE_MS"),
    recallMaxChars: required(cfg.CONTEXT_RECALL_MAX_CHARS, "CONTEXT_RECALL_MAX_CHARS"),
  });
  app.use("/mcp", requireToken(agent, ui), mcp, notFound);
  app.use(notFound); // any other path, with the contract's error body
  app.use(onError(isUp));

  const server = createServer(app);

  // Browsers cannot set headers on a WebSocket, so the UI token comes as ?token= (contracts.md
  // section 10). Any other path or token is refused before the upgrade.
  // A client only sends subscribe messages, so 16 kB is plenty; ws refuses anything larger.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !tokenMatches(url.searchParams.get("token") ?? undefined, ui)) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  const stopSocket = attachEventSocket(wss, { events, db });
  const stopSweeper = startLeaseSweeper({ db, events });
  // server.close() waits for every connection to end, and upgraded sockets never end on their own,
  // so the sockets must go before the close, not on its 'close' event.
  const closeServer = server.close.bind(server);
  server.close = (callback) => {
    stopSocket();
    stopSweeper();
    for (const ws of wss.clients) ws.terminate();
    return closeServer(callback);
  };

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
