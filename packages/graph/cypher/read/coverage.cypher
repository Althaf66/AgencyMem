// Current requirements with no passing test (TD coverage.cypher): a requirement is covered when every
// criterion of every card that implements it has TestCases, and each passed in the latest e2e run
// (every run of one submit_test_run shares its ranAt). A requirement with no card, a criterion with
// no TestCase, or a case that failed or did not run there is listed. Before any e2e run, all are.
OPTIONAL MATCH (e:TestRun {projectId: $projectId, scope: 'e2e'})
WITH max(e.ranAt) AS lastAt
MATCH (r:Requirement {projectId: $projectId})
WHERE r.validTo IS NULL
OPTIONAL MATCH (r)<-[:IMPLEMENTS]-(:Task)-[:HAS_CRITERION]->(k:AcceptanceCriterion)
OPTIONAL MATCH (k)<-[:VERIFIES]-(c:TestCase)
OPTIONAL MATCH (c)<-[:RUNS]-(run:TestRun {scope: 'e2e', passed: true})
WHERE run.ranAt = lastAt
WITH r, k, c, count(run) AS passes
WITH r, count(k) AS criteria, sum(CASE WHEN c IS NULL OR passes = 0 THEN 1 ELSE 0 END) AS gaps
WHERE criteria = 0 OR gaps > 0
RETURN 'Requirement' AS label, r.id AS id, r.key AS key, r.text AS title
ORDER BY key
