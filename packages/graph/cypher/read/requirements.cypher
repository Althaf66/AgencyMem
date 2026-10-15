// The project's current Requirements with the facts they derive from (recall_context, proposal).
MATCH (r:Requirement {projectId: $projectId})
WHERE r.validTo IS NULL
OPTIONAL MATCH (r)-[:DERIVED_FROM]->(f:Fact)
RETURN r.id AS id, r.key AS key, r.text AS text, r.priority AS priority, collect(f.id) AS factIds,
  r.version AS version
ORDER BY key
