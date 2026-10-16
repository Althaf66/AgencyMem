// Why a named card could not be claimed: its column, attempts and lease, and the keys of the cards
// it depends on that are not Done. It groups on the node, not on its properties: missing (null)
// properties as grouping keys drop the row, and with parameters they crash FalkorDB.
MATCH (t:Task {projectId: $projectId, id: $taskId})
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task)
WHERE d.column <> 'Done'
WITH t, collect(d.key) AS openKeys
RETURN t.key AS key, t.column AS column, t.attempts AS attempts, t.leaseOwner AS leaseOwner,
  t.leaseUntil AS leaseUntil, openKeys
