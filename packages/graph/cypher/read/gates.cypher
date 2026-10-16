// The project's Gates for route 10, with what their rules read (stage-machine.md section 5):
// G1 is decidable when a discovery item is done and no Question is open; G2 when a proposal item is
// done and none is open or claimed; G3 when an architect item is done and no architect or
// architect_revise item is open or claimed; G5 when the newest launch item is done and a
// ReadinessReport exists (T22), with whether the newest report passed (task 5.2).
OPTIONAL MATCH (w:WorkItem {projectId: $projectId, kind: 'discovery', status: 'done'})
WITH count(w) AS discoveryDone
OPTIONAL MATCH (q:Question {projectId: $projectId, status: 'open'})
WITH discoveryDone, count(q) AS openQuestions
OPTIONAL MATCH (p:WorkItem {projectId: $projectId, kind: 'proposal'})
WITH discoveryDone, openQuestions,
  sum(CASE WHEN p.status = 'done' THEN 1 ELSE 0 END) AS proposalDone,
  sum(CASE WHEN p.status IN ['open', 'claimed'] THEN 1 ELSE 0 END) AS proposalOpen
OPTIONAL MATCH (a:WorkItem {projectId: $projectId})
WHERE a.kind IN ['architect', 'architect_revise']
WITH discoveryDone, openQuestions, proposalDone, proposalOpen,
  sum(CASE WHEN a.kind = 'architect' AND a.status = 'done' THEN 1 ELSE 0 END) AS architectDone,
  sum(CASE WHEN a.status IN ['open', 'claimed'] THEN 1 ELSE 0 END) AS architectOpen
OPTIONAL MATCH (l:WorkItem {projectId: $projectId, kind: 'launch'})
WITH discoveryDone, openQuestions, proposalDone, proposalOpen, architectDone, architectOpen,
  max(l.createdAt) AS launchAt
OPTIONAL MATCH (ll:WorkItem {projectId: $projectId, kind: 'launch', createdAt: launchAt})
WITH discoveryDone, openQuestions, proposalDone, proposalOpen, architectDone, architectOpen,
  collect(ll.status)[0] AS lastLaunch
OPTIONAL MATCH (rr:ReadinessReport {projectId: $projectId})
WITH discoveryDone, openQuestions, proposalDone, proposalOpen, architectDone, architectOpen,
  lastLaunch, max(rr.createdAt) AS reportAt
OPTIONAL MATCH (lr:ReadinessReport {projectId: $projectId, createdAt: reportAt})
WITH discoveryDone, openQuestions, proposalDone, proposalOpen, architectDone, architectOpen,
  lastLaunch, collect(lr.passed)[0] AS reportPassed
MATCH (g:Gate {projectId: $projectId})
RETURN g, discoveryDone, openQuestions, proposalDone, proposalOpen, architectDone, architectOpen,
  lastLaunch, reportPassed
ORDER BY g.key, g.createdAt
