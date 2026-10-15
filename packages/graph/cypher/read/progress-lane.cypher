// Route 15, metric lane:<Lane>: the cards of one lane.
MATCH (t:Task {projectId: $projectId, lane: $lane})
RETURN 'Task' AS label, t.id AS id, t.key AS key, t.title AS title
ORDER BY t.order, t.key
