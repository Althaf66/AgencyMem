// Writes one write_tests call in one query (contracts.md section 7, write_tests):
// 1. Every case's criterion is a criterion of the Task; else no row and nothing is written.
// 2. Each case's TestCase MERGEs on (projectId, file), gets its title and version + 1, and VERIFIES
//    its AcceptanceCriterion.
// 3. When every criterion of the Task now has a TestCase and the card is in Backlog or Rework,
//    the card moves to Ready (version + 1); a fix card only once its G6 is approved (T26).
MATCH (t:Task {projectId: $projectId, id: $taskId})
OPTIONAL MATCH (t)-[:HAS_CRITERION]->(k:AcceptanceCriterion)
WITH t.column AS before, collect(k.key) AS keys
WHERE all(c IN $cases WHERE c.criterionKey IN keys)
// FalkorDB: aggregated values in scope break the MATCH inside the CALL below (gotcha 8).
WITH before
CALL {
  UNWIND $cases AS c
  MATCH (:Task {projectId: $projectId, id: $taskId})-[:HAS_CRITERION]->(k:AcceptanceCriterion)
  WHERE k.key = c.criterionKey
  MERGE (x:TestCase {projectId: $projectId, file: c.file})
  ON CREATE SET x.id = c.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0
  SET x.title = c.title, x.version = x.version + 1
  MERGE (x)-[:VERIFIES]->(k)
  RETURN collect([x.file, x.id]) AS cases, max(x.version) AS caseVersion
}
CALL {
  MATCH (t:Task {projectId: $projectId, id: $taskId})-[:HAS_CRITERION]->(k:AcceptanceCriterion)
  OPTIONAL MATCH (k)<-[:VERIFIES]-(x:TestCase)
  WITH t, k, count(x) AS tests
  WITH t, min(tests) AS fewest
  // FalkorDB: after an aggregation, a property filter on g here matches nothing (gotcha 10).
  OPTIONAL MATCH (g:Gate)-[:GUARDS]->(t)
  WITH t, fewest, sum(CASE WHEN g.status = 'approved' THEN 1 ELSE 0 END) AS approved
  FOREACH (_ IN CASE WHEN fewest > 0 AND (t.kind = 'build' OR approved > 0)
    AND t.column IN ['Backlog', 'Rework']
    THEN [1] ELSE [] END | SET t.column = 'Ready', t.version = t.version + 1)
  RETURN t.column AS after, t.version AS version
}
RETURN cases, caseVersion, before, after, version
