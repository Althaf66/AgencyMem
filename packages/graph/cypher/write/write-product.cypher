// Writes one write_product call in one query (contracts.md section 7, write_product):
// 1. Version check: the current product version (the highest productVersion among current
//    Features, or 0) must equal $baseVersion. Otherwise no row comes back and nothing changes.
// 2. Current Requirements and Features left out of the input end (validTo); none is deleted.
// 3. Requirements MERGE on key, with DERIVED_FROM to their facts; Features MERGE on key, with
//    HAS_REQUIREMENT; one Estimate per Feature (FOR), updated in place. Each written node gets
//    productVersion = $productVersion and its version + 1 (a new node starts at 1).
// `current` stays a grouping key in each collect: an aggregation with no key returns one row even
// from zero rows, which would undo the version check.
// Each MERGE part runs in its own CALL {}: in FalkorDB, a MERGE that follows another write and an
// aggregation in the same query part matches the first row's node for every row.
// The gateway sends at least one requirement and one feature, so the UNWINDs keep their rows.
OPTIONAL MATCH (cur:Feature {projectId: $projectId})
WHERE cur.validTo IS NULL
WITH coalesce(max(cur.productVersion), 0) AS current
WHERE current = $baseVersion
OPTIONAL MATCH (oldR:Requirement {projectId: $projectId})
WHERE oldR.validTo IS NULL AND NOT oldR.key IN [x IN $requirements | x.key]
WITH current, collect(oldR) AS endR
OPTIONAL MATCH (oldF:Feature {projectId: $projectId})
WHERE oldF.validTo IS NULL AND NOT oldF.key IN [x IN $features | x.key]
WITH current, endR, collect(oldF) AS endF
FOREACH (o IN endR + endF | SET o.validTo = $now, o.version = o.version + 1)
WITH [o IN endR + endF | o.id] AS ended
CALL {
  UNWIND $requirements AS req
  MERGE (r:Requirement {projectId: $projectId, key: req.key})
  ON CREATE SET r.id = req.id, r.createdBy = $createdBy, r.createdAt = $now, r.version = 0
  SET r.text = req.text, r.priority = req.priority, r.productVersion = $productVersion,
    r.version = r.version + 1, r.validTo = null
  WITH r, req
  OPTIONAL MATCH (r)-[d:DERIVED_FROM]->(:Fact)
  DELETE d
  WITH r, req, count(d) AS removed
  UNWIND req.factIds AS factId
  MATCH (f:Fact {id: factId, projectId: $projectId})
  WHERE f.validTo IS NULL
  CREATE (r)-[:DERIVED_FROM]->(f)
  WITH r, count(f) AS sources
  RETURN collect([r.key, r.id, r.version]) AS requirements
}
CALL {
  UNWIND $features AS fe
  MERGE (x:Feature {projectId: $projectId, key: fe.key})
  ON CREATE SET x.id = fe.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0
  SET x.name = fe.name, x.featureKind = fe.featureKind, x.productVersion = $productVersion,
    x.version = x.version + 1, x.validTo = null
  MERGE (e:Estimate {projectId: $projectId})-[:FOR]->(x)
  ON CREATE SET e.id = fe.estimate.id, e.createdBy = $createdBy, e.createdAt = $now, e.version = 0
  SET e.hours = fe.estimate.hours, e.rawHours = fe.estimate.rawHours, e.basis = fe.estimate.basis,
    e.lessonIds = fe.estimate.lessonIds, e.productVersion = $productVersion,
    e.version = e.version + 1
  WITH x, e, fe
  OPTIONAL MATCH (x)-[h:HAS_REQUIREMENT]->(:Requirement)
  DELETE h
  WITH x, e, fe, count(h) AS removed
  UNWIND fe.requirementKeys AS reqKey
  MATCH (r:Requirement {projectId: $projectId, key: reqKey})
  CREATE (x)-[:HAS_REQUIREMENT]->(r)
  WITH x, e, count(r) AS links
  RETURN collect([x.key, x.id, x.version, e.id, e.version]) AS features
}
RETURN ended, requirements, features
