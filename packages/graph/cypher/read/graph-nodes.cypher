// Route 16 without a focus: the project's nodes in creation (ULID) order, up to $limit.
MATCH (n {projectId: $projectId})
RETURN properties(n) AS p, labels(n)[0] AS label
ORDER BY n.id
LIMIT $limit
