// Route 27: the project's newest ReadinessReport (C8), or no row. `checks` is a JSON string (C10).
MATCH (r:ReadinessReport {projectId: $projectId})
RETURN r.id AS id, r.passed AS passed, r.override AS override, r.checks AS checks,
  r.createdAt AS createdAt
ORDER BY createdAt DESC, id DESC
LIMIT 1
