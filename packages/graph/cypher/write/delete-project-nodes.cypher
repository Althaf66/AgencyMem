// A project delete (route DELETE /api/projects/:id, client graph): every node of the project with
// its edges. Every node carries projectId, so the client's other projects in this graph stay.
MATCH (n {projectId: $projectId})
DETACH DELETE n
RETURN count(n) AS removed
