// POST /api/projects/:id/ask: the person's question as an ask Episode and the ask WorkItem the
// Discovery agent answers, in one query, so a question never waits without its item.
CREATE (e:Episode {id: $episodeId, projectId: $projectId, kind: 'ask', text: $text,
  createdBy: $createdBy, createdAt: $now, version: 1}),
  (w:WorkItem {id: $itemId, projectId: $projectId, kind: 'ask', status: 'open',
  subjectId: $episodeId, outputIds: [], attempts: 0,
  createdBy: $createdBy, createdAt: $now, version: 1})
RETURN e, w
