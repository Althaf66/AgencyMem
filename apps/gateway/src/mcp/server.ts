// The MCP endpoint: McpServer and StreamableHTTPServerTransport, stateful, one transport per
// Mcp-Session-Id (contracts.md section 7, "Session rules").
import { randomUUID } from "node:crypto";
import express, { type Response, type Router } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  isInitializeRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolName, tools, type ErrorBody, type Rejection } from "@agencymem/contracts";
import type { FalkorDB } from "@agencymem/graph";
import pkg from "../../package.json" with { type: "json" };
import { tokenMatches } from "../auth";
import type { Events } from "../events/bus";
import { ownership } from "./guards";
import { bindSession, type Binding, type TokenKind } from "./session";
import { HANDLERS, type Outcome, type ToolCtx } from "./tools";
import { guardFail } from "./tools/common";

/** One line per tool (from the contracts tool table), and the task that builds it. */
const TOOL_INFO: Record<ToolName, { description: string; task: string }> = {
  claim_item: {
    description: "Claim the oldest open work item of your kinds and start a lease.",
    task: "1.8",
  },
  heartbeat: { description: "Renew the lease on a work item or card.", task: "1.8" },
  complete_item: {
    description: "Finish a claimed work item as done or failed, with its runs.",
    task: "1.8",
  },
  recall_context: {
    description: "Read what a work item needs: item, project and context.",
    task: "1.8",
  },
  write_handoff: { description: "Leave a summary and output ids on a work item.", task: "1.8" },
  write_fact: { description: "Write sourced Facts and their Entities.", task: "2.5" },
  write_question: {
    description: "Write Questions with their Assumption and Contradiction.",
    task: "2.6",
  },
  write_product: {
    description: "Write Requirements, Features and Estimates (versioned).",
    task: "3.1",
  },
  record_change_request: {
    description: "Supersede facts from a change request and flag impact.",
    task: "3.3",
  },
  find_impact: { description: "List the nodes a fact touches.", task: "1.8" },
  write_design: {
    description: "Write design nodes and document sections (versioned).",
    task: "3.4",
  },
  write_cards: {
    description: "Create or update cards with criteria and dependencies.",
    task: "3.6",
  },
  write_tests: { description: "Record the test cases for a card's criteria.", task: "3.8" },
  submit_test_run: { description: "Record test run results for a commit.", task: "4.9" },
  claim_task: { description: "Claim the next ready card and start a lease.", task: "4.2" },
  get_task_context: { description: "Read everything a build run needs for one card.", task: "4.7" },
  complete_task: {
    description: "Close a card once its tests pass on the latest commit.",
    task: "4.10",
  },
  report_defect: { description: "Record a defect caused by a commit.", task: "5.3" },
  propose_fix: { description: "Propose a fix card that waits for gate G6.", task: "5.3" },
  write_case_study: {
    description: "Write the case study, estimate records and lessons.",
    task: "5.4",
  },
  read_query: { description: "Run a read-only Cypher query (UI session only).", task: "1.8" },
};

/**
 * The contract's failure shape: isError and `{ error: Rejection }` as the text item. No
 * structuredContent: the SDK client checks it against the tool's success outputSchema even on an
 * error, so OpenCode (which lists the tools) would see only a schema error.
 */
export function failure(error: Rejection): CallToolResult {
  const body: ErrorBody = { error };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(body) }] };
}

/** The contract's success shape: `structuredContent` = the output, and the same JSON as text. */
function success(output: unknown): CallToolResult {
  return {
    structuredContent: output as Record<string, unknown>,
    content: [{ type: "text", text: JSON.stringify(output) }],
  };
}

/** What every session's tools need from the gateway. */
export type ToolDeps = {
  db: () => Promise<FalkorDB>;
  /** Whether FalkorDB answers now: a failed call is then GRAPH_UNAVAILABLE, not INTERNAL. */
  isUp: () => Promise<boolean>;
  events: Events;
  leaseMs: number;
  recallMaxChars: number;
  contextMaxChars: number;
};

/**
 * An MCP server for one session, with all 21 tools, so tools/list returns every tool to every
 * session. Calls run: input schema, then (UI session) ownership, then the tool's own guards, its
 * write and its events, then the output schema.
 */
export function createMcpServer(binding: Binding, deps: ToolDeps): McpServer {
  const server = new McpServer({ name: "agencymem", version: pkg.version });
  for (const name of ToolName.options) {
    server.registerTool(
      name,
      {
        description: TOOL_INFO[name].description,
        inputSchema: tools[name].input,
        outputSchema: tools[name].output,
      },
      () => failure({ code: "INTERNAL", reason: "not reached" }),
    );
  }
  // The SDK validates input before a tool runs and answers a failure with plain text. Replace its
  // tools/call so a failure is the contract's VALIDATION_FAILED Rejection, checked with the full
  // contracts schema (refinements included).
  server.server.removeRequestHandler("tools/call");
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = ToolName.safeParse(request.params.name);
    if (!name.success) {
      return failure({ code: "NOT_FOUND", reason: `Unknown tool ${request.params.name}.` });
    }
    const input = tools[name.data].input.safeParse(request.params.arguments ?? {});
    if (!input.success) {
      return failure({
        code: "VALIDATION_FAILED",
        reason: `Invalid input for ${name.data}.`,
        details: {
          issues: input.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
      });
    }
    const handler = HANDLERS[name.data] as
      | ((ctx: ToolCtx, input: unknown) => Promise<Outcome<unknown>>) // the map pairs each tool with its input type
      | undefined;
    if (!handler) {
      return failure({
        code: "INTERNAL",
        reason: `${name.data} is not built yet (task ${TOOL_INFO[name.data].task}).`,
      });
    }

    // Anything that throws below (FalkorDB down, a parse of graph data) still answers in the
    // contract's shape; otherwise the SDK would send a bare JSON-RPC error.
    try {
      const ctx: ToolCtx = {
        tool: name.data,
        binding,
        db: await deps.db(),
        events: deps.events,
        leaseMs: deps.leaseMs,
        recallMaxChars: deps.recallMaxChars,
        contextMaxChars: deps.contextMaxChars,
        now: Date.now,
      };
      // contracts.md section 7: a UI session may call only read_query; ownership rejects the rest.
      const uiRefused = binding.kind === "ui" ? ownership({ kind: "ui" }, name.data) : null;
      if (uiRefused) return failure((await guardFail(ctx, uiRefused)).error);

      const outcome = await handler(ctx, input.data);
      if (!outcome.ok) return failure(outcome.error);
      // The SDK checked successful output against the output schema; this handler does it now.
      if (!tools[name.data].output.safeParse(outcome.output).success) {
        return failure({
          code: "INTERNAL",
          reason: `${name.data} produced output that breaks its contract.`,
        });
      }
      return success(outcome.output);
    } catch (e) {
      if (!(await deps.isUp())) {
        return failure({ code: "GRAPH_UNAVAILABLE", reason: "FalkorDB is not reachable." });
      }
      // Message only: no stack, and nothing from the request.
      console.error(`gateway: ${name.data} failed: ${e instanceof Error ? e.message : String(e)}`);
      return failure({ code: "INTERNAL", reason: `${name.data} failed on the server.` });
    }
  });
  return server;
}

type Session = { transport: StreamableHTTPServerTransport; kind: TokenKind; binding: Binding };

function send(res: Response, status: number, error: Rejection): void {
  const body: ErrorBody = { error };
  res.status(status).json(body);
}

/**
 * The /mcp router. It runs behind requireToken(agent, ui). An initialize request binds the X-AM-*
 * headers and opens a session; later requests find their session by Mcp-Session-Id.
 */
export function mcpRouter(opts: { agentToken: string } & ToolDeps): Router {
  const sessions = new Map<string, Session>();
  const router = express.Router();
  // write_fact takes up to 200 facts, more than Express's 100 kB default.
  router.use(express.json({ limit: "1mb" }));

  router.all("/", async (req, res) => {
    const kind: TokenKind = tokenMatches(req.get("X-AM-Token"), opts.agentToken) ? "agent" : "ui";
    const sessionId = req.get("Mcp-Session-Id");

    if (sessionId) {
      const session = sessions.get(sessionId);
      if (!session)
        return send(res, 404, { code: "NOT_FOUND", reason: "Unknown or closed MCP session." });
      // The token kind is bound to the session, so a session id alone cannot be taken over.
      if (session.kind !== kind) {
        return send(res, 401, {
          code: "UNAUTHORIZED",
          reason: "This session belongs to another token.",
        });
      }
      return session.transport.handleRequest(req, res, req.body);
    }

    if (req.method !== "POST" || !isInitializeRequest(req.body)) {
      return send(res, 400, {
        code: "VALIDATION_FAILED",
        reason: "Send initialize first, or send the Mcp-Session-Id header.",
      });
    }
    const bound = await bindSession((name) => req.get(name), kind, opts.db);
    if (!bound.ok) return send(res, bound.status, bound.error);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, kind, binding: bound.binding });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await createMcpServer(bound.binding, opts).connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
