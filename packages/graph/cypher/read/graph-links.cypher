// Route 16: every edge between the nodes it returns.
MATCH (a {projectId: $projectId})-[r]->(b)
WHERE a.id IN $ids AND b.id IN $ids AND type(r) <> 'RECALLED'
RETURN a.id AS source, b.id AS target, type(r) AS type
