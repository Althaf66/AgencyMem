// The handoffs of a project's done work items, newest first (recall_context `handoffs`).
MATCH (w:WorkItem {projectId: $projectId, status: 'done'})
WHERE w.handoff IS NOT NULL
RETURN w.kind AS kind, w.handoff AS summary, w.doneAt AS doneAt
ORDER BY w.doneAt DESC
