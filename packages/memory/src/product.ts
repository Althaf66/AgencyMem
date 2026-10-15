// Requirements, Features and Estimates (write_product). One Cypher query per call.
import { text, type Actor, type FeatureKind, type Priority } from "@agencymem/contracts";
import { writeQuery } from "@agencymem/graph/write";
import { ulid } from "ulid";
import type { Ctx } from "./ctx";

export type RequirementWrite = { key: string; text: string; priority: Priority; factIds: string[] };
export type FeatureWrite = {
  key: string;
  name: string;
  featureKind: FeatureKind;
  requirementKeys: string[];
  estimate: { rawHours: number; hours: number; basis: string; lessonIds: string[] };
};

/**
 * Writes product version `baseVersion + 1`: Requirements and Features MERGE on key, one Estimate per
 * Feature updated in place, and current ones left out of the input end (never deleted). Id lists
 * follow the input order. Null when `baseVersion` is not the current product version; nothing
 * changes then. Needs at least one requirement and one feature.
 */
export async function writeProduct(
  ctx: Ctx,
  input: {
    baseVersion: number;
    requirements: RequirementWrite[];
    features: FeatureWrite[];
    createdBy: Actor;
    now: number;
  },
): Promise<{
  productVersion: number;
  requirementIds: string[];
  featureIds: string[];
  estimateIds: string[];
  ended: string[];
  /** The version of the first node of each label, for its node.written event. */
  versions: { requirement: number; feature: number; estimate: number };
} | null> {
  if (input.requirements.length === 0 || input.features.length === 0) {
    throw new Error("writeProduct needs at least one requirement and one feature");
  }
  const productVersion = input.baseVersion + 1;
  const rows = await writeQuery<{
    ended: string[];
    requirements: [string, string, number][];
    features: [string, string, number, string, number][];
  }>(ctx.db, ctx.graph, "write/write-product", {
    projectId: ctx.projectId,
    baseVersion: input.baseVersion,
    productVersion,
    requirements: input.requirements.map((r) => ({
      id: ulid(),
      key: r.key,
      text: text(300).parse(r.text), // checked before it is written
      priority: r.priority,
      factIds: [...new Set(r.factIds)], // one edge per fact
    })),
    features: input.features.map((f) => ({
      id: ulid(),
      key: f.key,
      name: text(80).parse(f.name),
      featureKind: f.featureKind,
      requirementKeys: [...new Set(f.requirementKeys)],
      estimate: { ...f.estimate, id: ulid(), basis: text(200).parse(f.estimate.basis) },
    })),
    createdBy: input.createdBy,
    now: input.now,
  });
  const row = rows[0];
  if (!row) return null;
  const requirements = new Map(
    row.requirements.map(([key, id, version]) => [key, { id, version }]),
  );
  const features = new Map(
    row.features.map(([key, id, version, estimateId, estimateVersion]) => [
      key,
      { id, version, estimateId, estimateVersion },
    ]),
  );
  const req = (key: string) => requirements.get(key)!;
  const feat = (key: string) => features.get(key)!;
  return {
    productVersion,
    requirementIds: input.requirements.map((r) => req(r.key).id),
    featureIds: input.features.map((f) => feat(f.key).id),
    estimateIds: input.features.map((f) => feat(f.key).estimateId),
    ended: row.ended,
    versions: {
      requirement: req(input.requirements[0]!.key).version,
      feature: feat(input.features[0]!.key).version,
      estimate: feat(input.features[0]!.key).estimateVersion,
    },
  };
}
