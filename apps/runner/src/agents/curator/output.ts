// The Curator's JSON (agent-prompts.md section 9, CuratorOutput). The texts are clipped after the
// anonymity step, so the model's text gets a little room here.
import { FeatureKind } from "@agencymem/contracts";
import { z } from "zod";

export const CuratorOutput = z.object({
  lessonsLearned: z.string().min(1).max(2000),
  lessons: z.array(z.object({ featureKind: FeatureKind, text: z.string().min(1).max(400) })).min(1),
});
export type CuratorOutput = z.infer<typeof CuratorOutput>;
