// The Episodes of one Document in reading order, with the Document's name (recall_context, intake).
MATCH (e:Episode {projectId: $projectId, documentId: $documentId})-[:PART_OF]->(d:Document)
RETURN e.id AS id, e.kind AS kind, d.name AS documentName, e.page AS page,
  e.lineStart AS lineStart, e.lineEnd AS lineEnd, e.text AS text
ORDER BY e.page, e.lineStart
