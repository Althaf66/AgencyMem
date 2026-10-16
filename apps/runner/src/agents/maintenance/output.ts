// The Maintenance agent's JSON (agent-prompts.md section 8, MaintenanceOutput).
import { DefectSeverity, Lane, text } from "@agencymem/contracts";
import { z } from "zod";

export const MaintenanceOutput = z.object({
  title: text(120),
  severity: DefectSeverity,
  requirementKey: z.string(),
  codeChangeSha: z.string(),
  reasoning: text(600),
  fix: z.object({
    title: text(80),
    description: text(1200),
    lane: Lane,
    designKeys: z.array(z.string()),
    criteria: z
      .array(z.object({ key: z.string(), text: text(300), testIds: z.array(z.string()).min(1) }))
      .min(1)
      .max(3),
  }),
});
export type MaintenanceOutput = z.infer<typeof MaintenanceOutput>;
