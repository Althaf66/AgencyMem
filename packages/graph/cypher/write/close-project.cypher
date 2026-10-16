// Route 29 (T28): closedAt on the registry Project, once, while it is in maintenance. No row back:
// the project moved on or was closed already.
MATCH (p:Project {id: $projectId})
WHERE p.stage = 'maintenance' AND p.closedAt IS NULL
SET p.closedAt = $now, p.version = p.version + 1
RETURN p
