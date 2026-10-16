// What the evidence guard needs to close a card (complete_task, contracts.md section 7): the card's
// build commits (not the Test agent's spec commits, which get no test run), its TestCases with
// their criterion keys and every run of each, and the commits that still have an open or claimed
// test_run item. The gateway takes the latest commit (committedAt is whole seconds, so ties go by
// when the gateway recorded it, then by id) and checks its runs. It replaces the
// technical design's query, which counted spec commits as the latest. Pattern comprehensions and
// one grouping on the card node: grouping on missing properties breaks FalkorDB.
MATCH (t:Task {projectId: $projectId, id: $taskId})
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'test_run'})
WHERE w.status IN ['open', 'claimed']
WITH t, collect(w.subjectId) AS pending
RETURN
  [(c:CodeChange)-[:FOR_TASK]->(t) WHERE c.author <> 'agencymem-test' |
    {id: c.id, sha: c.sha, committedAt: c.committedAt, createdAt: c.createdAt}] AS commits,
  [(t)-[:HAS_CRITERION]->(k:AcceptanceCriterion)<-[:VERIFIES]-(tc:TestCase) |
    {id: tc.id, key: k.key,
     runs: [(tc)<-[:RUNS]-(r:TestRun) | {sha: r.sha, passed: r.passed, ranAt: r.ranAt}]}] AS cases,
  pending
