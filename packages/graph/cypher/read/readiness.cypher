// Three of the Launch agent's checks (agent-prompts.md section 10): the cards not Done, the open
// Assumptions, the open or fixing Defects, with their ids, and the totals their details name. The
// coverage check reads coverage.cypher; drift is git log in the runner.
OPTIONAL MATCH (t:Task {projectId: $projectId})
WITH count(t) AS cards, collect(CASE WHEN t.column <> 'Done' THEN t.id END) AS notDone
OPTIONAL MATCH (a:Assumption {projectId: $projectId, status: 'open'})
WITH cards, notDone, collect(a.id) AS openAssumptions
OPTIONAL MATCH (d:Defect {projectId: $projectId})
WHERE d.status IN ['open', 'fixing']
WITH cards, notDone, openAssumptions, collect(d.id) AS openDefects
OPTIONAL MATCH (r:Requirement {projectId: $projectId})
WHERE r.validTo IS NULL
RETURN cards, notDone, openAssumptions, openDefects, count(r) AS requirements
