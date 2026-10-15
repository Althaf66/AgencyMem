// App-side joins (technical design "Agency graph"): FalkorDB edges cannot cross graphs, so an
// Estimate in a client graph names its agency Lessons by id, and the app joins the two results.

/** Each feature with its estimate's `lessonIds` replaced by the Lessons they name. Unknown ids drop. */
export function joinLessons<
  E extends { lessonIds: string[] },
  F extends { estimate: E },
  L extends { id: string },
>(
  features: F[],
  lessons: L[],
): (Omit<F, "estimate"> & { estimate: Omit<E, "lessonIds"> & { lessons: L[] } })[] {
  const byId = new Map(lessons.map((l) => [l.id, l]));
  return features.map(({ estimate: { lessonIds, ...estimate }, ...feature }) => ({
    ...feature,
    estimate: { ...estimate, lessons: lessonIds.flatMap((id) => byId.get(id) ?? []) },
  }));
}
