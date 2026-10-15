// The Architect's JSON (agent-prompts.md section 5, ArchitectOutput): write_design's node and
// section shapes.
import { DesignNodeInput, DocSectionInput } from "@agencymem/contracts";
import { z } from "zod";

export const ArchitectOutput = z.object({
  nodes: z.array(DesignNodeInput),
  sections: z.array(DocSectionInput),
});
export type ArchitectOutput = z.infer<typeof ArchitectOutput>;
