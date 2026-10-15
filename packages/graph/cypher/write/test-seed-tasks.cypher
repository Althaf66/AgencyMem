// Test seed only (task 3.3, until write_cards exists in 3.6): build Tasks that IMPLEMENT a
// Requirement and USE an Endpoint (when `uses` names one).
UNWIND $tasks AS t
MATCH (tr:Requirement {projectId: $projectId, key: t.requirementKey})
CREATE (tn:Task {id: t.id, projectId: $projectId, key: t.key, title: t.key, description: 'Test.',
  lane: 'Backend', column: t.column, order: t.order, kind: 'build', attempts: 0,
  leaseOwner: t.leaseOwner, leaseUntil: t.leaseUntil, createdBy: $createdBy, createdAt: $now,
  version: 1})-[:IMPLEMENTS]->(tr)
WITH tn, t
OPTIONAL MATCH (te:Endpoint {projectId: $projectId, key: t.uses})
FOREACH (x IN CASE WHEN te IS NULL THEN [] ELSE [te] END | CREATE (tn)-[:USES]->(x))
RETURN tn.id AS id, tn.key AS key
