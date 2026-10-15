// The project's design nodes with the requirement keys they derive from (recall_context for the
// architect and planner kinds).
MATCH (n {projectId: $projectId})
WHERE n:Decision OR n:Component OR n:Screen OR n:DataEntity OR n:Endpoint OR n:Risk
OPTIONAL MATCH (n)-[:DERIVED_FROM]->(r:Requirement)
RETURN n.id AS id, labels(n)[0] AS label, n.key AS key, n.name AS name, n.body AS body,
  n.method AS method, n.path AS path, collect(r.key) AS requirementKeys
ORDER BY key
