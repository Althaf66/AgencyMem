// Route 14, the progress header: done and total cards per lane, current requirements with a
// passing TestRun (coverage), open Assumptions and open Defects. Stage and gates come from their own
// reads.
OPTIONAL MATCH (t:Task {projectId: $projectId})
WITH collect(CASE WHEN t IS NULL THEN null ELSE {lane: t.lane, done: t.column = 'Done'} END) AS cards
OPTIONAL MATCH (r:Requirement {projectId: $projectId})
WHERE r.validTo IS NULL
OPTIONAL MATCH (r)<-[:IMPLEMENTS]-(:Task)-[:HAS_CRITERION]->(:AcceptanceCriterion)<-[:VERIFIES]-(:TestCase)<-[:RUNS]-(run:TestRun)
WHERE run.passed = true
WITH cards, r, count(run) AS passes
WITH cards, count(r) AS total, sum(CASE WHEN passes > 0 THEN 1 ELSE 0 END) AS covered
OPTIONAL MATCH (a:Assumption {projectId: $projectId, status: 'open'})
WITH cards, total, covered, count(a) AS openAssumptions
OPTIONAL MATCH (d:Defect {projectId: $projectId})
WHERE d.status IN ['open', 'fixing']
RETURN cards, total, covered, openAssumptions, count(d) AS openDefects
