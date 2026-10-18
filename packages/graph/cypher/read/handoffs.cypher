// The handoffs of a project's done work items, newest first (recall_context `handoffs`). An ask's
// handoff is its answer to a person, read by the next ask (ask-history), not by every agent.
MATCH (w:WorkItem {projectId: $projectId, status: 'done'})
WHERE w.handoff IS NOT NULL AND w.kind <> 'ask'
RETURN w.kind AS kind, w.handoff AS summary, w.doneAt AS doneAt
ORDER BY w.doneAt DESC
