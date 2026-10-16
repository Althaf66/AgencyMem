// Route 29 (T28's condition): the fix cards that are neither Done nor rejected at their G6. The Gate
// is matched by label only and its key and status tested in the CASE (FalkorDB gotcha 10).
MATCH (t:Task {projectId: $projectId, kind: 'fix'})
OPTIONAL MATCH (g:Gate)-[:GUARDS]->(t)
WITH t, collect(CASE WHEN g.key = 'G6' AND g.status = 'rejected' THEN 1 END) AS rejected
WHERE t.column <> 'Done' AND size(rejected) = 0
RETURN t.key AS key
ORDER BY key
