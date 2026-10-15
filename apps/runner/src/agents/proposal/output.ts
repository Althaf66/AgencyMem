// The Proposal agent's JSON (agent-prompts.md section 4, ProposalOutput). The runner turns each
// feature's rawHours into an estimate with the lessons; the parts are checked, not stored.
import { FeatureKey, FeatureKind, RequirementInput, text } from "@agencymem/contracts";
import { z } from "zod";

const hours = z.number().nonnegative().multipleOf(0.5);

const ProposalFeature = z.object({
  key: FeatureKey,
  name: text(80),
  featureKind: FeatureKind,
  requirementKeys: z.array(z.string()).min(1),
  parts: z.object({ data: hours, api: hours, ui: hours, tests: hours }),
  rawHours: hours,
  scopeNote: z.string().optional(),
});
export const ProposalOutput = z.object({
  summary: text(600),
  requirements: z.array(RequirementInput),
  features: z.array(ProposalFeature),
});
export type ProposalOutput = z.infer<typeof ProposalOutput>;
