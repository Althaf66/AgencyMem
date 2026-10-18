// The project's answered asks, newest first (recall_context `ask.earlier`): each question with the
// answer the Discovery agent left as the item's handoff, so a follow-up question has its thread.
MATCH (w:WorkItem {projectId: $projectId, kind: 'ask', status: 'done'})
WHERE w.handoff IS NOT NULL AND w.id <> $itemId
MATCH (e:Episode {id: w.subjectId})
RETURN e.text AS question, w.handoff AS answer, w.doneAt AS at
ORDER BY at DESC
LIMIT 10
