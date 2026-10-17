// A card's test runs, newest first: TestRun -RUNS-> TestCase -VERIFIES-> criterion of the Task.
MATCH (t:Task {id: $taskId, projectId: $projectId})-[:HAS_CRITERION]->(:AcceptanceCriterion)<-[:VERIFIES]-(tc:TestCase)<-[:RUNS]-(r:TestRun)
RETURN DISTINCT r.id AS id, r.sha AS sha, r.passed AS passed, r.durationMs AS durationMs,
       r.ranAt AS ranAt, r.scope AS scope, r.error AS error, tc.title AS testCase, tc.file AS file
ORDER BY ranAt DESC
LIMIT 50
