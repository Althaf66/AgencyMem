// Route 12: the project's cards with what a card face and its drawer show (CardView): the
// requirement, dependencies, the CRs that flagged it, its commits, its criteria with their
// TestCases, a fix card's G6, and the TestRuns of those TestCases (the gateway works out the test status). With
// $taskId, that one card (route 13's answer).
MATCH (t:Task {projectId: $projectId})
WHERE $taskId IS NULL OR t.id = $taskId
OPTIONAL MATCH (t)-[:IMPLEMENTS]->(r:Requirement)
WITH t, collect(r.key)[0] AS requirementKey
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task)
WITH t, requirementKey, collect(d.key) AS dependsOn
OPTIONAL MATCH (t)-[:FLAGGED_BY]->(cr:ChangeRequest)
WITH t, requirementKey, dependsOn,
  collect(CASE WHEN cr IS NULL THEN null ELSE [cr.id, cr.key, cr.createdAt] END) AS crs
OPTIONAL MATCH (c:CodeChange)-[:FOR_TASK]->(t)
WITH t, requirementKey, dependsOn, crs,
  collect(CASE WHEN c IS NULL THEN null ELSE {sha: c.sha, message: c.message,
    committedAt: c.committedAt, linked: c.linked} END) AS commits
OPTIONAL MATCH (t)-[:HAS_CRITERION]->(k:AcceptanceCriterion)
OPTIONAL MATCH (k)<-[:VERIFIES]-(x:TestCase)
WITH t, requirementKey, dependsOn, crs, commits, k, count(x) AS cases
WITH t, requirementKey, dependsOn, crs, commits,
  collect(CASE WHEN k IS NULL THEN null ELSE {id: k.id, key: k.key, text: k.text,
    testIds: k.testIds, testCaseCount: cases} END) AS criteria
// FalkorDB: after an aggregation, a property filter on g here matches nothing (gotcha 10); only a
// G6 GUARDS a card.
OPTIONAL MATCH (g:Gate)-[:GUARDS]->(t)
WITH t, requirementKey, dependsOn, crs, commits, criteria,
  collect(CASE WHEN g IS NULL THEN null ELSE {id: g.id, key: g.key, status: g.status} END)[0] AS gate
OPTIONAL MATCH (t)-[:HAS_CRITERION]->(:AcceptanceCriterion)<-[:VERIFIES]-(:TestCase)<-[:RUNS]-(run:TestRun)
RETURN t, requirementKey, dependsOn, crs, commits, criteria, gate,
  collect(CASE WHEN run IS NULL THEN null ELSE {passed: run.passed, ranAt: run.ranAt} END) AS runs
ORDER BY t.order, t.key
