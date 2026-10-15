// Lessons for the Proposal agent (agent-prompts.md section 4) and route 26, from the agency graph:
// every Lesson of the given featureKinds in any clarityBand, so the runner can fall back from
// (featureKind, clarityBand) to featureKind alone (C3).
MATCH (l:Lesson)
WHERE l.featureKind IN $featureKinds
RETURN l.id AS id, l.featureKind AS featureKind, l.clarityBand AS clarityBand, l.ratio AS ratio,
  l.n AS n, l.text AS text, coalesce(l.projectIds, []) AS projectIds
ORDER BY featureKind, clarityBand, id
