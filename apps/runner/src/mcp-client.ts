// The runner's way into the gateway: one MCP session per agent and project (contracts.md section 7,
// Session rules), typed tool calls checked by the contracts schemas, route 30 for run steps, and
// route 2 to find the projects.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { z } from "zod";
import {
  ErrorBody,
  ListProjectsResponse,
  Rejection,
  tools,
  type AgentId,
  type RunStepBody,
  type ToolName,
} from "@agencymem/contracts";

export type ToolIn<K extends ToolName> = z.input<(typeof tools)[K]["input"]>;
export type ToolOut<K extends ToolName> = z.output<(typeof tools)[K]["output"]>;
export type StepBody = z.input<typeof RunStepBody>;

/** A tool call the gateway refused, with its Rejection (a guard rejection or another error). */
export class ToolRejected extends Error {
  override name = "ToolRejected";
  constructor(
    readonly tool: string,
    readonly rejection: Rejection,
  ) {
    super(rejection.reason);
  }
  get reasonCode(): string | undefined {
    return this.rejection.details?.reasonCode;
  }
}

export type Session = {
  agent: AgentId;
  projectId: string;
  call<K extends ToolName>(name: K, input: ToolIn<K>): Promise<ToolOut<K>>;
  /** Posts one run step. A failure is logged, never thrown: steps only feed the screens. */
  step(body: StepBody): Promise<void>;
  close(): Promise<void>;
};

export type Gateway = { gatewayUrl: string; token: string };

export async function openSession(
  gw: Gateway,
  at: { agent: AgentId; projectId: string; workerId: string },
): Promise<Session> {
  const headers = {
    "X-AM-Token": gw.token,
    "X-AM-Agent": at.agent,
    "X-AM-Project": at.projectId,
    "X-AM-Worker": at.workerId,
  };
  const client = new Client({ name: `agencymem-runner-${at.workerId}`, version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${gw.gatewayUrl}/mcp`), {
    requestInit: { headers },
  });
  await client.connect(transport);

  return {
    agent: at.agent,
    projectId: at.projectId,
    async call(name, input) {
      const result = await client.callTool({ name, arguments: input as Record<string, unknown> });
      if (result.isError) {
        const body = ErrorBody.safeParse(result.structuredContent);
        const rejection: Rejection = body.success
          ? body.data.error
          : { code: "INTERNAL", reason: `${name} failed with no rejection body.` };
        throw new ToolRejected(name, rejection);
      }
      return tools[name].output.parse(result.structuredContent) as ToolOut<typeof name>;
    },
    async step(body) {
      try {
        const res = await fetch(`${gw.gatewayUrl}/api/runs/steps`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status !== 202) console.warn(`runner: run step refused (${res.status})`);
      } catch (e) {
        console.warn(`runner: run step not sent: ${e instanceof Error ? e.message : "error"}`);
      }
    },
    // client.close() only drops the connection; the DELETE ends the session on the gateway too.
    async close() {
      await transport.terminateSession().catch(() => undefined);
      await client.close();
    },
  };
}

/** The ids of the projects the runner works on: every project not closed (route 2). */
export async function listProjects(gw: Gateway): Promise<string[]> {
  const res = await fetch(`${gw.gatewayUrl}/api/projects`, {
    headers: { "X-AM-Token": gw.token },
  });
  if (!res.ok) throw new Error(`GET /api/projects answered ${res.status}`);
  const { projects } = ListProjectsResponse.parse(await res.json());
  return projects.filter((p) => p.stage !== "closed").map((p) => p.id);
}
