// The project's current Features, each with its requirement keys and its Estimate (recall_context
// for proposal, route 26). The Estimate's lessonIds are joined with the agency Lessons in the app.
MATCH (x:Feature {projectId: $projectId})<-[:FOR]-(e:Estimate)
WHERE x.validTo IS NULL
OPTIONAL MATCH (x)-[:HAS_REQUIREMENT]->(r:Requirement)
RETURN x.id AS id, x.key AS key, x.name AS name, x.featureKind AS featureKind,
  x.productVersion AS productVersion, collect(r.key) AS requirementKeys,
  x.actualHours AS actualHours,
  {id: e.id, hours: e.hours, rawHours: e.rawHours, basis: e.basis, lessonIds: e.lessonIds} AS estimate
ORDER BY key
