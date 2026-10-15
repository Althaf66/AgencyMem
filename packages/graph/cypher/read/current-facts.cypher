// The project's current Facts (no validTo) with the Episodes each is sourced from: the source guard
// of write_question and the facts of recall_context.
MATCH (f:Fact {projectId: $projectId})-[:SOURCED_FROM]->(e:Episode)
WHERE f.validTo IS NULL
RETURN f.id AS id, f.statement AS statement, f.subject AS subject, f.attribute AS attribute,
  f.value AS value, collect(e.id) AS episodeIds
ORDER BY f.createdAt, f.id
