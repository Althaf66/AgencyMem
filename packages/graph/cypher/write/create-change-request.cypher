// Route 22 (stage-machine.md C1): the change_request Episode with the client's words, and the
// ChangeRequest (status open) FROM it. One query, so a CR never exists without its source.
CREATE (e:Episode {id: $episodeId, projectId: $projectId, kind: 'change_request', text: $text,
  createdBy: $createdBy, createdAt: $now, version: 1}),
  (cr:ChangeRequest {id: $crId, projectId: $projectId, text: $text, status: 'open',
  createdBy: $createdBy, createdAt: $now, version: 1})-[:FROM]->(e)
RETURN cr, e
