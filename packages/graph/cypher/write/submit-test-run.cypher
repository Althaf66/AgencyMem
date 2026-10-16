// One TestRun per result (submit_test_run, contracts.md section 7), each RUNS its TestCase and
// carries the commit's sha. With a card in Testing: a failure moves it to In progress with the
// failing criterion keys as its note (version + 1); a full pass leaves it in Testing. The card goes
// first: a MATCH after a write and an aggregation can find nothing in FalkorDB.
OPTIONAL MATCH (t:Task {projectId: $projectId, id: $taskId})
WITH t, t.column AS fromColumn
FOREACH (x IN CASE WHEN t IS NOT NULL AND t.column = 'Testing' AND $failed THEN [1] ELSE [] END |
  SET t.version = t.version + 1, t.column = 'In progress', t.note = $note)
WITH t, fromColumn
UNWIND $results AS r
MATCH (tc:TestCase {projectId: $projectId, id: r.testCaseId})
CREATE (run:TestRun {id: r.id, projectId: $projectId, sha: $sha, passed: r.passed,
  durationMs: r.durationMs, ranAt: $now, scope: $scope, createdBy: $createdBy, createdAt: $now,
  version: 1})-[:RUNS]->(tc)
SET run.error = r.error
RETURN run.id AS id, fromColumn, t.column AS toColumn, t.version AS taskVersion
