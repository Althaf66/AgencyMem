// A project delete (route DELETE /api/projects/:id, registry graph), last of the three writes: the
// Project node. Its Client stays, even with no project left. No row back: no such project.
MATCH (p:Project {id: $projectId})
DELETE p
RETURN $projectId AS id
