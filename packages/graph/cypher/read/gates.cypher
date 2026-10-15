// The project's Gates for route 10, with what their rules read (stage-machine.md section 5):
// G1 is decidable when a discovery item is done and no Question is open; G2 when a proposal item is
// done and none is open or claimed.
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'discovery', status: 'done'})
WITH count(w) AS discoveryDone
OPTIONAL MATCH (q:Question {projectId: $projectId, status: 'open'})
WITH discoveryDone, count(q) AS openQuestions
OPTIONAL MATCH (p:WorkItem {projectId: $projectId, kind: 'proposal'})
WITH discoveryDone, openQuestions,
  sum(CASE WHEN p.status = 'done' THEN 1 ELSE 0 END) AS proposalDone,
  sum(CASE WHEN p.status IN ['open', 'claimed'] THEN 1 ELSE 0 END) AS proposalOpen
MATCH (g:Gate {projectId: $projectId})
RETURN g, discoveryDone, openQuestions, proposalDone, proposalOpen
ORDER BY g.key, g.createdAt
