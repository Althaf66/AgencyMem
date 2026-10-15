// The agents the runner starts, one loop each. Each agent lives in its own folder:
// agents/<agent>/{agent.ts, prompt.md, output.ts} (agent-prompts.md section 1).
import type { Agent } from "../agent";
import { architect } from "./architect/agent";
import { discovery } from "./discovery/agent";
import { intake } from "./intake/agent";
import { proposal } from "./proposal/agent";
import { changeRequest } from "./proposal/change-request";

export const AGENTS: Agent<unknown>[] = [intake, discovery, proposal, changeRequest, architect];
