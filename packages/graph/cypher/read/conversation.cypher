// The Memory screen's turns (GET /api/projects/:id/memory): every uploaded file, question, answer,
// change request and ask of the project and each ask's reply, each with the Facts sourced from it,
// for a CR the Facts it ended, and for a reply the Facts it cites. Pattern comprehensions, not
// aggregation (falkordb gotchas); the app sorts by `at` and counts distinct ids.
MATCH (d:Document {projectId: $projectId})
RETURN 'document' AS kind, d.id AS id, d.name AS text, d.createdAt AS at, null AS refId,
  [(f:Fact)-[:SOURCED_FROM]->(:Episode)-[:PART_OF]->(d) | f.id] AS factIds, [] AS endedIds,
  [] AS sourceIds
UNION ALL
MATCH (q:Question {projectId: $projectId})
RETURN 'question' AS kind, q.id AS id, q.text AS text, q.createdAt AS at, null AS refId,
  [] AS factIds, [] AS endedIds, [] AS sourceIds
UNION ALL
MATCH (e:Episode {projectId: $projectId, kind: 'answer'})-[:ANSWERS]->(q:Question)
RETURN 'answer' AS kind, e.id AS id, e.text AS text, e.createdAt AS at, q.id AS refId,
  [] AS factIds, [] AS endedIds, [] AS sourceIds
UNION ALL
MATCH (cr:ChangeRequest {projectId: $projectId})-[:FROM]->(e:Episode)
RETURN 'change_request' AS kind, cr.id AS id, cr.key + ': ' + cr.text AS text, cr.createdAt AS at,
  null AS refId, [(f:Fact)-[:SOURCED_FROM]->(e) | f.id] AS factIds,
  [(cr)-[:ENDS]->(o:Fact) | o.id] AS endedIds, [] AS sourceIds
UNION ALL
MATCH (e:Episode {projectId: $projectId, kind: 'ask'})
RETURN 'ask' AS kind, e.id AS id, e.text AS text, e.createdAt AS at, null AS refId,
  [] AS factIds, [] AS endedIds, [] AS sourceIds
UNION ALL
MATCH (w:WorkItem {projectId: $projectId, kind: 'ask', status: 'done'})
WHERE w.handoff IS NOT NULL
RETURN 'reply' AS kind, w.id AS id, w.handoff AS text, w.doneAt AS at, w.subjectId AS refId,
  [] AS factIds, [] AS endedIds, w.outputIds AS sourceIds
