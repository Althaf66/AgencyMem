import { reject, type GuardResult } from "./run";

/**
 * Rejects an input element (a fact, question, requirement or design node) with no source, or with
 * a source that does not exist in the project. `known` holds the ids that exist, and for sources
 * that must be current (write_product's facts) only the current ones. `index` in the details is
 * the element's position in the input array.
 */
export function source(
  elements: { ids: string[] }[],
  known: ReadonlySet<string>,
): GuardResult | null {
  for (const [index, element] of elements.entries()) {
    if (element.ids.length === 0) {
      return reject("source", "SOURCE_MISSING", `Item ${index} has no source.`, { index });
    }
    const unknown = element.ids.find((id) => !known.has(id));
    if (unknown) {
      return reject(
        "source",
        "SOURCE_UNKNOWN",
        `Item ${index} names a source that does not exist: ${unknown}.`,
        {
          index,
        },
      );
    }
  }
  return null;
}
