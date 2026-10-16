// propose_fix (contracts.md section 7) in one query: a fix Task in Backlog that IMPLEMENTS its
// Requirement, USES its design nodes, HAS_CRITERION its new AcceptanceCriteria and DEPENDS_ON its
// cards; FIXES the Defect (now fixing); and a Gate G6 (waiting) that GUARDS it.
// 1. The Defect is open, the card key is free and the requirement is current; else no row and
//    nothing is written.
// 2. The writes. USES and DEPENDS_ON each run in their own CALL {}, as in write-cards.cypher
//    (FalkorDB gotchas 6 and 8).
MATCH (defect:Defect {projectId: $projectId, id: $defectId})
WHERE defect.status = 'open'
OPTIONAL MATCH (taken:Task {projectId: $projectId, key: $key})
WITH defect, count(taken) AS existing
WHERE existing = 0
MATCH (r:Requirement {projectId: $projectId, key: $requirementKey})
WHERE r.validTo IS NULL
SET defect.status = 'fixing', defect.version = defect.version + 1
CREATE (t:Task {id: $taskId, projectId: $projectId, key: $key, title: $title,
  description: $description, lane: $lane, column: 'Backlog', order: $order, kind: 'fix',
  attempts: 0, createdBy: $createdBy, createdAt: $now, version: 1})
CREATE (t)-[:IMPLEMENTS]->(r)
CREATE (t)-[:FIXES]->(defect)
CREATE (:Gate {id: $gateId, projectId: $projectId, key: 'G6', status: 'waiting',
  createdBy: $createdBy, createdAt: $now, version: 1})-[:GUARDS]->(t)
FOREACH (k IN $criteria |
  CREATE (t)-[:HAS_CRITERION]->(:AcceptanceCriterion {id: k.id, projectId: $projectId,
    key: k.key, text: k.text, testIds: k.testIds, createdBy: $createdBy, createdAt: $now,
    version: 1}))
WITH t
CALL {
  WITH t
  OPTIONAL MATCH (d {projectId: $projectId})
  WHERE d.key IN $designKeys
    AND (d:Decision OR d:Component OR d:Screen OR d:DataEntity OR d:Endpoint OR d:Risk)
  FOREACH (n IN CASE WHEN d IS NULL THEN [] ELSE [d] END | CREATE (t)-[:USES]->(n))
  RETURN count(d) AS uses
}
CALL {
  WITH t
  OPTIONAL MATCH (b:Task {projectId: $projectId})
  WHERE b.key IN $dependsOn
  FOREACH (n IN CASE WHEN b IS NULL THEN [] ELSE [b] END | CREATE (t)-[:DEPENDS_ON]->(n))
  RETURN count(b) AS dependencies
}
RETURN t.id AS taskId, uses, dependencies
