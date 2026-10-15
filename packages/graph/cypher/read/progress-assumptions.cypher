// Route 15, metric openAssumptions.
MATCH (a:Assumption {projectId: $projectId, status: 'open'})
RETURN 'Assumption' AS label, a.id AS id, a.text AS title
ORDER BY a.createdAt
