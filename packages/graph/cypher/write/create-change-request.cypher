// Route 22 (stage-machine.md C1): the change_request Episode with the client's words, and the
// ChangeRequest (status open) FROM it. One query, so a CR never exists without its source. The key
// numbers the project's CRs from 1 (CR-1, CR-2).
// ponytail: two CRs created in the same moment can read the same count; FalkorDB runs one write
// query at a time per graph, so this holds unless that changes.
OPTIONAL MATCH (old:ChangeRequest {projectId: $projectId})
WITH count(old) AS existing
CREATE (e:Episode {id: $episodeId, projectId: $projectId, kind: 'change_request', text: $text,
  createdBy: $createdBy, createdAt: $now, version: 1}),
  (cr:ChangeRequest {id: $crId, projectId: $projectId, key: 'CR-' + toString(existing + 1),
  text: $text, status: 'open',
  createdBy: $createdBy, createdAt: $now, version: 1})-[:FROM]->(e)
RETURN cr, e
