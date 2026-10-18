// The Memory screen's turns (GET /api/projects/:id/memory): every uploaded file, question, answer
// and change request of the project, each with the Facts sourced from it and, for a CR, the Facts it
// ended. Pattern comprehensions, not aggregation (falkordb gotchas); the app sorts by `at` and
// counts distinct ids.
MATCH (d:Document {projectId: $projectId})
RETURN 'document' AS kind, d.id AS id, d.name AS text, d.createdAt AS at, null AS refId,
  [(f:Fact)-[:SOURCED_FROM]->(:Episode)-[:PART_OF]->(d) | f.id] AS factIds, [] AS endedIds
UNION ALL
MATCH (q:Question {projectId: $projectId})
RETURN 'question' AS kind, q.id AS id, q.text AS text, q.createdAt AS at, null AS refId,
  [] AS factIds, [] AS endedIds
UNION ALL
MATCH (e:Episode {projectId: $projectId, kind: 'answer'})-[:ANSWERS]->(q:Question)
RETURN 'answer' AS kind, e.id AS id, e.text AS text, e.createdAt AS at, q.id AS refId,
  [] AS factIds, [] AS endedIds
UNION ALL
MATCH (cr:ChangeRequest {projectId: $projectId})-[:FROM]->(e:Episode)
RETURN 'change_request' AS kind, cr.id AS id, cr.key + ': ' + cr.text AS text, cr.createdAt AS at,
  null AS refId, [(f:Fact)-[:SOURCED_FROM]->(e) | f.id] AS factIds,
  [(cr)-[:ENDS]->(o:Fact) | o.id] AS endedIds
