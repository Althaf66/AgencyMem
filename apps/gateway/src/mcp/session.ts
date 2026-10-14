// Binds the X-AM-* headers of an MCP initialize request to the new session (contracts.md section 7,
// "Session rules"). A missing or bad header, or an unknown project, refuses the session: HTTP 400.
import { AgentId, Id, WorkerId, type Rejection } from "@agencymem/contracts";
import { UnknownProjectError, graphFor, type FalkorDB } from "@agencymem/graph";

/** Which token opened the session. A UI session may call only read_query (the tools decide). */
export type TokenKind = "agent" | "ui";

export type Binding =
  | { kind: "agent"; agent: AgentId; workerId: string; projectId: string; graph: string }
  | { kind: "ui"; projectId: string; graph: string };

export type BindResult =
  { ok: true; binding: Binding } | { ok: false; status: 400 | 503; error: Rejection };

const refuse = (reason: string): BindResult => ({
  ok: false,
  status: 400,
  error: { code: "VALIDATION_FAILED", reason },
});

export async function bindSession(
  header: (name: string) => string | undefined,
  kind: TokenKind,
  db: () => Promise<FalkorDB>,
): Promise<BindResult> {
  const project = Id.safeParse(header("X-AM-Project"));
  if (!project.success) return refuse("X-AM-Project must be a project id.");
  const projectId = project.data;

  let agent: AgentId | undefined;
  let workerId: string | undefined;
  if (kind === "agent") {
    const a = AgentId.safeParse(header("X-AM-Agent"));
    if (!a.success) return refuse(`X-AM-Agent must be one of: ${AgentId.options.join(", ")}.`);
    const w = WorkerId.safeParse(header("X-AM-Worker"));
    if (!w.success) return refuse("X-AM-Worker must match ^[a-z0-9-]{1,40}$.");
    agent = a.data;
    workerId = w.data;
  }

  let graph: string;
  try {
    graph = await graphFor(await db(), projectId);
  } catch (e) {
    if (e instanceof UnknownProjectError) return refuse(`Unknown project ${projectId}.`);
    return {
      ok: false,
      status: 503,
      error: { code: "GRAPH_UNAVAILABLE", reason: "FalkorDB is not reachable." },
    };
  }

  return agent && workerId
    ? { ok: true, binding: { kind: "agent", agent, workerId, projectId, graph } }
    : { ok: true, binding: { kind: "ui", projectId, graph } };
}
