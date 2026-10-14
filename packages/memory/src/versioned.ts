import { writeQuery } from "@agencymem/graph/write";
import type { Ctx } from "./ctx";

/** What FalkorDB can store in a property: no maps (C10). Null removes the property. */
type Scalar = string | number | boolean;
export type PropValue = Scalar | Scalar[] | null;

/** Properties a versioned write may never set: identity, ownership and the version itself. */
const FIXED = ["id", "projectId", "createdBy", "createdAt", "version"];

/**
 * Sets `props` on node `id` when `version` is its current version, and raises the version by 1.
 * Returns the new version, or null when the version was old (or the node is unknown); nothing
 * changes then. A null value removes the property (C10).
 */
export async function writeVersioned(
  ctx: Ctx,
  input: { id: string; version: number; props: Record<string, PropValue> },
): Promise<number | null> {
  const fixed = Object.keys(input.props).filter((key) => FIXED.includes(key));
  if (fixed.length > 0) throw new Error(`writeVersioned cannot set ${fixed.join(", ")}`);
  const rows = await writeQuery<{ version: number }>(ctx.db, ctx.graph, "write/write-versioned", {
    id: input.id,
    version: input.version,
    props: input.props,
  });
  return rows[0]?.version ?? null;
}
