// The Planner's JSON (agent-prompts.md section 6, PlannerOutput): write_cards' card shape, with no
// version (create mode).
import { CardInput } from "@agencymem/contracts";
import { z } from "zod";

export const PlannerOutput = z.object({ cards: z.array(CardInput.omit({ version: true })) });
export type PlannerOutput = z.infer<typeof PlannerOutput>;
