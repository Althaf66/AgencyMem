// The Facts a ChangeRequest ended (it ENDS them), each with its Episodes and the Fact that replaced
// it: recall_context for a replan item (agent-prompts.md section 6, "facts with the replaced ones").
MATCH (:ChangeRequest {projectId: $projectId, id: $crId})-[:ENDS]->(f:Fact)-[:SOURCED_FROM]->(e:Episode)
OPTIONAL MATCH (n:Fact)-[:SUPERSEDES]->(f)
RETURN f.id AS id, f.statement AS statement, f.subject AS subject, f.attribute AS attribute,
  f.value AS value, collect(DISTINCT e.id) AS episodeIds, f.validTo AS validTo,
  collect(DISTINCT n.id)[0] AS replacedBy
ORDER BY f.createdAt, f.id
