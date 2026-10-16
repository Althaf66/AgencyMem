// Route 19: keeps the last backtrace query time on the Project, which the health panel shows
// (task 5.6, approved decision 5). Not versioned: it is a measurement, not an edit.
MATCH (p:Project {id: $projectId})
SET p.backtraceMs = $ms
RETURN p.id AS id
