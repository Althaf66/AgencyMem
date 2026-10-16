// contracts.md sections 2 (conventions) and 5 (shared types).
import { z } from "zod";
import { AgentId, ClarityBand, Endpoint, Mode, Stage } from "./enums";

/** ULID, 26 characters, Crockford base32. */
export const Id = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "must be a ULID");
export type Id = z.infer<typeof Id>;

/** Integer epoch milliseconds (UTC). */
export const EpochMs = z.int().nonnegative();
export type EpochMs = z.infer<typeof EpochMs>;

export const Count = z.int().nonnegative();

/** A person writing through REST: `human:<name>` or `persona:<projectId>`, plus `persona:sim`
 * (P, task 5.5) for the simulator creating a project, before it has a project id. */
export const PersonActor = z.union([
  z.templateLiteral(["human:", z.string().min(1)]),
  z.templateLiteral(["persona:", Id]),
  z.literal("persona:sim"),
]);
export type PersonActor = z.infer<typeof PersonActor>;

export const Actor = z.union([AgentId, PersonActor]);
export type Actor = z.infer<typeof Actor>;

/** The `X-AM-Worker` header, also stored as `leaseOwner`. */
export const WorkerId = z.string().regex(/^[a-z0-9-]{1,40}$/, "must match ^[a-z0-9-]{1,40}$");
export type WorkerId = z.infer<typeof WorkerId>;

/** A full git commit sha. */
export const Sha = z.string().regex(/^[0-9a-f]{40}$/, "must be 40 hex characters");

/** Text with a maximum length. Longer text is rejected, never cut. */
export const text = (max: number) => z.string().max(max);

/** A human-readable key: the prefix, a dash, two or more digits (`REQ-01`). */
const key = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}-\\d{2,}$`), `must look like ${prefix}-01`);
export const RequirementKey = key("REQ");
export const FeatureKey = key("FEAT");
export const CardKey = key("CARD");
/** A change request's key, numbered per project from 1 as the UI shows it: CR-1, CR-2 (P). */
export const CrKey = z.string().regex(/^CR-\d+$/, "must look like CR-1");
export const CriterionKey = z.string().regex(/^AC-\d{2,}-\d+$/, "must look like AC-01-1");
/** Key prefix of each design label. */
export const DESIGN_KEY_PREFIX = {
  Decision: "DEC",
  Component: "CMP",
  Screen: "SCR",
  DataEntity: "ENT",
  Endpoint: "EP",
  Risk: "RSK",
} as const;
export const DesignKey = z
  .string()
  .regex(/^(DEC|CMP|SCR|ENT|EP|RSK)-\d{2,}$/, "must look like DEC-01");
/** Entity keys are kebab-case. */
export const EntityKey = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "must be kebab-case");
/** Fact attributes are snake_case. */
export const Attribute = z
  .string()
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "must be snake_case");

/**
 * C10: setting a FalkorDB property to null removes it, so a missing property reads as null.
 */
export const maybe = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

/** C10: FalkorDB cannot store a map, so an object property is a JSON string. */
export const jsonString = <T extends z.ZodType>(schema: T) =>
  z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "must be a JSON string" });
        return z.NEVER;
      }
    })
    .pipe(schema);

export const NodeRef = z.object({ label: z.string(), id: Id, version: z.int().min(1) });
export type NodeRef = z.infer<typeof NodeRef>;

export const RunInput = z.object({
  step: text(80),
  model: z.string(),
  endpoint: Endpoint,
  tokensIn: Count,
  tokensOut: Count,
  ms: Count,
  cost: z.number().nonnegative(),
});
export type RunInput = z.infer<typeof RunInput>;

export const ProjectInfo = z.object({
  id: Id,
  clientId: Id,
  clientName: z.string(),
  name: z.string(),
  mode: Mode,
  stage: Stage,
  productVersion: Count,
  designVersion: Count,
  clarity: z.object({ density: z.number().nonnegative(), band: ClarityBand }).nullable(),
  closedAt: EpochMs.nullable(),
  createdAt: EpochMs,
});
export type ProjectInfo = z.infer<typeof ProjectInfo>;

export const ReadinessCheck = z.object({
  name: z.enum(["cards_done", "coverage", "open_assumptions", "open_defects", "drift"]),
  passed: z.boolean(),
  detail: text(200),
  nodeIds: z.array(Id),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheck>;

export const CaseMetrics = z.object({
  estimateError: z.number().nonnegative(),
  questions: Count,
  contradictions: Count,
  changeRequests: Count,
  cardsReopened: Count,
  defects: Count,
  cards: Count,
  firstPassCards: Count,
  clarityBand: ClarityBand,
});
export type CaseMetrics = z.infer<typeof CaseMetrics>;

export const GraphView = z.object({
  nodes: z.array(
    z.object({
      id: Id,
      label: z.string(),
      title: z.string(),
      group: z.string(),
      state: z.enum(["ended", "stale", "rework", "failing"]).nullable(),
    }),
  ),
  links: z.array(
    z.object({ source: Id, target: Id, type: z.string(), label: z.string().nullable() }),
  ),
});
export type GraphView = z.infer<typeof GraphView>;
