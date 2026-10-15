// The Discovery agent's JSON (agent-prompts.md section 3, DiscoveryOutput).
import { QuestionKind, text } from "@agencymem/contracts";
import { z } from "zod";

export const DiscoveryQuestion = z.object({
  kind: QuestionKind,
  text: text(200).endsWith("?"),
  recommended: text(400),
  reasoning: text(600),
  assumption: text(300),
  approach: text(600),
  factIds: z.array(z.string()).min(1),
  contradictionSummary: text(300).optional(), // required for kind contradiction
});
export const DiscoveryOutput = z.object({ questions: z.array(DiscoveryQuestion).max(20) });
export type DiscoveryOutput = z.infer<typeof DiscoveryOutput>;
