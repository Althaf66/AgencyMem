// The inputs of a project's CaseMetrics (contracts.md section 5; recall_context for curator, and
// routes 24 and 25 in task 5.6): the counts, each current Feature's estimate and actual hours, and
// each card with its reopened count, its build commits (not the Test agent's spec commits) and the
// card-scope runs of its TestCases. The gateway works out estimateError and firstPassCards.
// Pattern comprehensions on the card node, as in evidence.cypher.
OPTIONAL MATCH (q:Question {projectId: $projectId})
WITH count(q) AS questions
OPTIONAL MATCH (c:Contradiction {projectId: $projectId})
WITH questions, count(c) AS contradictions
OPTIONAL MATCH (cr:ChangeRequest {projectId: $projectId})
WITH questions, contradictions, count(cr) AS changeRequests
OPTIONAL MATCH (x:Feature {projectId: $projectId})<-[:FOR]-(e:Estimate)
WHERE x.validTo IS NULL
WITH questions, contradictions, changeRequests,
  collect(CASE WHEN x IS NULL THEN null ELSE {hours: e.hours, actual: x.actualHours} END)
    AS features
OPTIONAL MATCH (t:Task {projectId: $projectId})
WITH questions, contradictions, changeRequests, features, t
RETURN questions, contradictions, changeRequests, features,
  collect(CASE WHEN t IS NULL THEN null ELSE {
    reopened: coalesce(t.reopened, 0),
    commits: [(cc:CodeChange)-[:FOR_TASK]->(t) WHERE cc.author <> 'agencymem-test' |
      {sha: cc.sha, committedAt: cc.committedAt, createdAt: cc.createdAt}],
    runs: [(t)-[:HAS_CRITERION]->(:AcceptanceCriterion)<-[:VERIFIES]-(:TestCase)<-[:RUNS]-(r:TestRun)
      WHERE r.scope = 'card' | {sha: r.sha, passed: r.passed}]
  } END) AS cards
