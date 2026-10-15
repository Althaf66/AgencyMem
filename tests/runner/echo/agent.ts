// A test agent in the agent folder pattern (agent.ts, prompt.md, output.ts): it reads the episodes
// of an intake item and hands off a one-line summary. It writes nothing else.
import { loadPrompt, type Agent } from "../../../apps/runner/src/agent";
import { EchoOutput } from "./output";

export const echo: Agent<EchoOutput> = {
  id: "intake",
  kinds: ["intake"],
  tier: "thin",
  task: "Say how many episodes CONTEXT holds.",
  prompt: await loadPrompt(import.meta.url, "Echo"),
  output: EchoOutput,
  handoff: ["intake"],
  select: (recall) => ({ episodes: recall.context.episodes ?? [] }),
  async act(output, _recall, act) {
    await act.say(`Echoed: ${output.summary}`);
    return { outputIds: [], summary: output.summary };
  },
};
