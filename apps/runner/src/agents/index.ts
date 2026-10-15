// The agents the runner starts, one loop each. Each agent lives in its own folder:
// agents/<agent>/{agent.ts, prompt.md, output.ts} (agent-prompts.md section 1).
// Intake arrives in task 2.5, Discovery in 2.6.
import type { Agent } from "../agent";

export const AGENTS: Agent<unknown>[] = [];
