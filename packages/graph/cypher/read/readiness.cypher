// Two of the Launch agent's checks (agent-prompts.md section 10): the cards not Done and the open
// Assumptions, with their ids, and the totals their details name. The coverage check reads
// coverage.cypher; drift is git log in the runner.
OPTIONAL MATCH (t:Task {projectId: $projectId})
WITH count(t) AS cards, collect(CASE WHEN t.column <> 'Done' THEN t.id END) AS notDone
OPTIONAL MATCH (a:Assumption {projectId: $projectId, status: 'open'})
WITH cards, notDone, collect(a.id) AS openAssumptions
OPTIONAL MATCH (r:Requirement {projectId: $projectId})
WHERE r.validTo IS NULL
RETURN cards, notDone, openAssumptions, count(r) AS requirements
