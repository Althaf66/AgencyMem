// The Intake agent's JSON (agent-prompts.md section 2, IntakeOutput): write_fact's fact shape.
import { FactInput } from "@agencymem/contracts";
import { z } from "zod";

export const IntakeOutput = z.object({ facts: z.array(FactInput).max(60) });
export type IntakeOutput = z.infer<typeof IntakeOutput>;
