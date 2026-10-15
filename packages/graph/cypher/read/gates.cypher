// The project's Gates for route 10, with what their rules read (stage-machine.md section 5):
// G1 is decidable when a discovery item is done and no Question is open.
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'discovery', status: 'done'})
WITH count(w) AS discoveryDone
OPTIONAL MATCH (q:Question {projectId: $projectId, status: 'open'})
WITH discoveryDone, count(q) AS openQuestions
MATCH (g:Gate {projectId: $projectId})
RETURN g, discoveryDone, openQuestions
ORDER BY g.key, g.createdAt
