// Route 15, metric coverage: the current requirements with a passing TestRun (the numerator).
MATCH (r:Requirement {projectId: $projectId})<-[:IMPLEMENTS]-(:Task)-[:HAS_CRITERION]->(:AcceptanceCriterion)<-[:VERIFIES]-(:TestCase)<-[:RUNS]-(run:TestRun)
WHERE r.validTo IS NULL AND run.passed = true
RETURN DISTINCT 'Requirement' AS label, r.id AS id, r.key AS key, r.text AS title
ORDER BY key
