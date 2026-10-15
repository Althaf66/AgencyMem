// Route 15, metric openDefects.
MATCH (d:Defect {projectId: $projectId})
WHERE d.status IN ['open', 'fixing']
RETURN 'Defect' AS label, d.id AS id, d.title AS title
ORDER BY d.createdAt
