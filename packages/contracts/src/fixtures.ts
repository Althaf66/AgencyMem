// fixtures.md sections 2 and 4: the truth sheet and planted list of each synthetic note set.
import { z } from "zod";
import { ClarityBand, FeatureKind } from "./enums";

export const FixtureSet = z.enum(["A", "B", "C"]);
export type FixtureSet = z.infer<typeof FixtureSet>;

export const FixtureFile = z.enum([
  "kickoff-notes.pdf",
  "client-summary.docx",
  "whatsapp-chat.txt",
]);
export type FixtureFile = z.infer<typeof FixtureFile>;

export const TruthSheet = z.object({
  set: FixtureSet,
  client: z.object({ name: z.string(), kind: z.string(), contact: z.string() }),
  staff: z.array(
    z.object({ id: z.string().regex(/^d\d+$/), name: z.string(), specialty: z.string() }),
  ),
  rules: z.array(
    z.object({ subject: z.string(), attribute: z.string(), value: z.string(), text: z.string() }),
  ),
  features: z.array(z.object({ key: z.string(), name: z.string(), featureKind: FeatureKind })),
  answers: z.array(z.object({ plantedId: z.string(), answer: z.string() })),
  lateChanges: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      subject: z.string(),
      attribute: z.string(),
      newValue: z.string(),
    }),
  ),
  defect: z.object({ text: z.string(), subject: z.string(), attribute: z.string() }),
});
export type TruthSheet = z.infer<typeof TruthSheet>;

export const PlantedLine = z.object({ file: FixtureFile, text: z.string() });
export type PlantedLine = z.infer<typeof PlantedLine>;

export const Planted = z.object({
  set: FixtureSet,
  expectedBand: ClarityBand,
  contradictions: z.array(
    z.object({
      id: z.string(),
      lines: z.tuple([PlantedLine, PlantedLine]),
      question: z.string(),
      truth: z.string(),
    }),
  ),
  unclear: z.array(
    z.object({ id: z.string(), line: PlantedLine, question: z.string(), truth: z.string() }),
  ),
  open: z.array(
    z.object({
      id: z.string(),
      topic: z.string(),
      keywords: z.array(z.string()),
      question: z.string(),
      truth: z.string(),
    }),
  ),
  // (P, task 2.9) Lines that agree with a planted line, such as "doctors keep 20 min per
  // patient". They are fixed lines too, so the fixture build checks them.
  support: z.array(PlantedLine),
});
export type Planted = z.infer<typeof Planted>;
