// Test seed only (task 3.3, until write_design exists in 3.4): Endpoints DERIVED_FROM a
// Requirement and DocSections that RENDER a Requirement. Each part runs in its own CALL {}: in
// FalkorDB a MATCH after a write and an aggregation in the same query part can find nothing.
CALL {
  UNWIND $endpoints AS d
  MATCH (dr:Requirement {projectId: $projectId, key: d.requirementKey})
  CREATE (dn:Endpoint {id: d.id, projectId: $projectId, key: d.key, name: d.key, body: 'Test.',
    method: 'GET', path: '/api/test', designVersion: 1, createdBy: $createdBy, createdAt: $now,
    version: 1})-[:DERIVED_FROM]->(dr)
  RETURN count(dn) AS endpoints
}
CALL {
  UNWIND $sections AS s
  MATCH (sr:Requirement {projectId: $projectId, key: s.requirementKey})
  CREATE (sn:DocSection {id: s.id, projectId: $projectId, doc: s.doc, order: s.order, title: 'Test',
    body: 'Test.', stale: false, designVersion: 1, createdBy: $createdBy, createdAt: $now,
    version: 1})-[:RENDERS]->(sr)
  RETURN count(sn) AS sections
}
RETURN endpoints, sections
