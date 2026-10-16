// record_change_request, write 2 (technical design "impact.flag"): every node the old facts touch,
// by the edges of read/impact.cypher. A Task moves to Rework (unless it is there already) with its
// lease cleared and its `reopened` count + 1 (approved decision 4); a DocSection becomes stale. Each changed node gets version + 1, and each flagged
// node FLAGGED_BY the CR. Returns one row per flagged node, with the column and lease it had.
// The facts come by `IN`, not UNWIND: in FalkorDB a variable-length match from a node bound by an
// UNWIND value in the same MATCH finds nothing.
MATCH (cr:ChangeRequest {id: $crId, projectId: $projectId})
MATCH (f:Fact)
WHERE f.id IN $factIds AND f.projectId = $projectId
MATCH (f)<-[:DERIVED_FROM|OF|IMPLEMENTS|USES|HAS_CRITERION|VERIFIES|RENDERS*1..6]-(n)
WHERE n:Task OR n:DocSection
WITH DISTINCT cr, n
WITH cr, n, n.column AS from, n.leaseOwner AS owner,
  CASE WHEN n:Task THEN 'Task' ELSE 'DocSection' END AS label
FOREACH (_ IN CASE WHEN label = 'Task' AND from <> 'Rework' THEN [1] ELSE [] END |
  SET n.column = 'Rework', n.leaseOwner = null, n.leaseUntil = null,
    n.reopened = coalesce(n.reopened, 0) + 1, n.version = n.version + 1)
FOREACH (_ IN CASE WHEN label = 'DocSection' AND n.stale = false THEN [1] ELSE [] END |
  SET n.stale = true, n.version = n.version + 1)
CREATE (n)-[:FLAGGED_BY]->(cr)
RETURN label, n.id AS id, n.key AS key, from, n.column AS to, n.version AS version, owner
