// The Test agent's JSON for a write_tests item (agent-prompts.md section 7, WriteTestsOutput).
import { CriterionKey } from "@agencymem/contracts";
import { z } from "zod";

export const WriteTestsOutput = z.object({
  files: z
    .array(z.object({ criterionKey: CriterionKey, path: z.string(), content: z.string().min(1) }))
    .min(1),
});
export type WriteTestsOutput = z.infer<typeof WriteTestsOutput>;
