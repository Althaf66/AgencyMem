// Route 29 (T28): the actual hours of each current Feature, version + 1, in one query. The route
// checked that $actuals name exactly the current features. Returns one row per Feature written.
UNWIND $actuals AS a
MATCH (x:Feature {projectId: $projectId, id: a.featureId})
WHERE x.validTo IS NULL
SET x.actualHours = a.actualHours, x.version = x.version + 1
RETURN x.id AS id, x.version AS version
