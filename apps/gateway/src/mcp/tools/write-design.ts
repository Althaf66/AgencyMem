import type { GateStatus, ToolInput, ToolOutput, WorkItemKind } from "@agencymem/contracts";
import { readQuery } from "@agencymem/graph";
import { writeDesign } from "@agencymem/memory";
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
 * write_design (contracts.md section 7). Guards: ownership, gate G2, source (each design node
 * names current Requirements; each section renders at least one existing node), version
 * (`baseVersion` is the current design version). Writes design version `baseVersion + 1`.
 */
export async function writeDesignTool(
  ctx: ToolCtx,
  input: ToolInput<"write_design">,
): Promise<Outcome<ToolOutput<"write_design">>> {
  const { agent } = agentOf(ctx);
  const found = await findOwn(ctx, input.itemId, "WorkItem");
  if (!found.ok) return found;
  const refused = ownership({ kind: "agent", agent }, "write_design", {
    itemKind: found.output.kind as WorkItemKind,
  });
  if (refused) return guardFail(ctx, refused);

  if (input.nodes.length === 0 && input.sections.length === 0) {
    return invalid("A design write needs at least one node or section.");
  }
  const twice =
    repeated(input.nodes.map((n) => n.key)) ??
    repeated(input.sections.map((s) => `${s.doc} ${s.order}`));
  if (twice) return invalid(`${twice} is written twice.`);

  const { db } = ctx;
  const { graph, projectId } = ctx.binding;
  const gates = await readQuery<{ g: { properties: { key: string; status: GateStatus } } }>(
    db,
    graph,
    "read/gates",
    { projectId },
  );
  const closed = gate("G2", gates.find((r) => r.g.properties.key === "G2")?.g.properties ?? null);
  if (closed) return guardFail(ctx, closed);

  const requirements = await readQuery<{ key: string }>(db, graph, "read/requirements", {
    projectId,
  });
  const reqKeys = new Set(requirements.map((r) => r.key));
  const nodeless = source(
    input.nodes.map((n) => ({ ids: n.requirementKeys })),
    reqKeys,
  );
  if (nodeless) return guardFail(ctx, nodeless);
  const features = await readQuery<{ key: string }>(db, graph, "read/features", { projectId });
  const design = await readQuery<{ key: string; label: string }>(db, graph, "read/design", {
    projectId,
  });
  // contracts.md section 2: a key is unique per project, so a key keeps its label.
  const labelOf = new Map(design.map((d) => [d.key, d.label]));
  const relabelled = input.nodes.find((n) => labelOf.has(n.key) && labelOf.get(n.key) !== n.label);
  if (relabelled) {
    return invalid(
      `${relabelled.key} is a ${labelOf.get(relabelled.key)}, not a ${relabelled.label}.`,
    );
  }
  const known = new Set([
    ...reqKeys,
    ...features.map((f) => f.key),
    ...design.map((d) => d.key),
    ...input.nodes.map((n) => n.key),
  ]);
  // A section must render at least one existing node; the keys it names that exist get the edges.
  const sectionless = source(
    input.sections.map((s) => ({ ids: s.renders.filter((key) => known.has(key)) })),
    known,
  );
  if (sectionless) return guardFail(ctx, sectionless);

  const [versions] = await readQuery<{ designVersion: number }>(
    db,
    graph,
    "read/product-versions",
    { projectId },
  );
  const stale = version(input.baseVersion, versions?.designVersion ?? 0);
  if (stale) return guardFail(ctx, stale);

  const written = await writeDesign(memoryCtx(ctx), {
    baseVersion: input.baseVersion,
    nodes: input.nodes,
    sections: input.sections,
    createdBy: agent,
    now: ctx.now(),
  });
  if (!written) {
    // Between the checks above and the write, another write took this version, or a requirement
    // or render target ended. Read again and retry.
    return guardFail(
      ctx,
      reject("version", "VERSION_OLD", `The design or a node it names changed; read again.`, {
        sent: input.baseVersion,
      }),
    );
  }

  // One node.written per label, in the order the labels first appear, then the sections.
  const labels = [...new Set(input.nodes.map((n) => n.label))];
  for (const label of labels) {
    const at = input.nodes.flatMap((n, i) => (n.label === label ? [i] : []));
    ctx.events.emit(projectId, "node.written", {
      label,
      id: written.nodeIds[at[0]!]!,
      version: written.nodeVersions[at[0]!]!,
      summary: `${at.length} ${label} nodes, design version ${written.designVersion}`,
      ids: at.map((i) => written.nodeIds[i]!),
    });
  }
  if (written.sectionIds.length) {
    ctx.events.emit(projectId, "node.written", {
      label: "DocSection",
      id: written.sectionIds[0]!,
      version: written.sectionVersions[0]!,
      summary: `${written.sectionIds.length} sections, design version ${written.designVersion}`,
      ids: written.sectionIds,
    });
  }
  const { designVersion, nodeIds, sectionIds } = written;
  return ok({ designVersion, nodeIds, sectionIds });
}
