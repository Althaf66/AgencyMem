import type { GateStatus, ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { writeProduct } from "@agencymem/memory";
import { gate, ownership, reject, source, version } from "../guards";
import {
  agentOf,
  findOwn,
  guardFail,
  invalid,
  memoryCtx,
  ok,
  type Outcome,
  type ToolCtx,
} from "./common";

const repeated = (keys: string[]) => keys.find((key, i) => keys.indexOf(key) !== i);

/**
 * write_product (contracts.md section 7). Guards: ownership, gate G1, source (each requirement cites
 * at least one current fact), version (`baseVersion` is the current product version). Writes the
 * Requirements, Features and Estimates of product version `baseVersion + 1`.
 */
export async function writeProductTool(
  ctx: ToolCtx,
  input: ToolInput<"write_product">,
): Promise<Outcome<ToolOutput<"write_product">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "write_product", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);

  if (input.requirements.length === 0 || input.features.length === 0) {
    return invalid("A product needs at least one requirement and one feature.");
  }
  const keys = input.requirements.map((r) => r.key);
  const twice = repeated(keys) ?? repeated(input.features.map((f) => f.key));
  if (twice) return invalid(`Key ${twice} is used twice.`);
  for (const [i, feature] of input.features.entries()) {
    const unknown = feature.requirementKeys.find((key) => !keys.includes(key));
    if (unknown) return invalid(`Feature ${i}: requirement ${unknown} is not in this product.`);
  }

  const { db } = ctx;
  const { graph, projectId } = ctx.binding;
  const gates = await readQuery<{ g: { properties: { key: string; status: GateStatus } } }>(
    db,
    graph,
    "read/gates",
    { projectId },
  );
  const g1 = gates.find((row) => row.g.properties.key === "G1")?.g.properties ?? null;
  const closed = gate("G1", g1);
  if (closed) return guardFail(ctx, closed);

  const current = await readQuery<{ id: string }>(db, graph, "read/current-facts", { projectId });
  const missing = source(
    input.requirements.map((r) => ({ ids: r.factIds })),
    new Set(current.map((f) => f.id)),
  );
  if (missing) return guardFail(ctx, missing);

  const [versions] = await readQuery<{ productVersion: number }>(
    db,
    graph,
    "read/product-versions",
    { projectId },
  );
  const stale = version(input.baseVersion, versions?.productVersion ?? 0);
  if (stale) return guardFail(ctx, stale);

  const written = await writeProduct(memoryCtx(ctx), {
    baseVersion: input.baseVersion,
    requirements: input.requirements,
    features: input.features,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) {
    // Another write took this version between the check above and the write.
    return guardFail(
      ctx,
      reject("version", "VERSION_OLD", `Version ${input.baseVersion} is old.`, {
        sent: input.baseVersion,
      }),
    );
  }

  const batches = [
    ["Requirement", written.requirementIds, written.versions.requirement, "requirements"],
    ["Feature", written.featureIds, written.versions.feature, "features"],
    ["Estimate", written.estimateIds, written.versions.estimate, "estimates"],
  ] as const;
  for (const [label, ids, nodeVersion, noun] of batches) {
    ctx.events.emit(projectId, "node.written", {
      label,
      id: ids[0]!,
      version: nodeVersion,
      summary: `${ids.length} ${noun}, product version ${written.productVersion}`,
      ids: [...ids],
    });
  }
  const { productVersion, requirementIds, featureIds, estimateIds, ended } = written;
  return ok({ productVersion, requirementIds, featureIds, estimateIds, ended });
}
