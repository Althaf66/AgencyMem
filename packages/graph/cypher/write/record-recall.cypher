// recall_context and get_task_context: the item gets one RECALLED edge to each node its answer named,
// by id or by key; a second recall moves the edge's `at`. Returns the ids it linked.
// ponytail: an unlabeled match scans the project's nodes; fine at demo size, add a label list if not.
MATCH (i {id: $itemId, projectId: $projectId})
MATCH (n {projectId: $projectId})
WHERE (n.id IN $ids OR n.key IN $keys) AND n.id <> $itemId
MERGE (i)-[r:RECALLED]->(n)
SET r.at = $at, r.agent = $agent
RETURN collect(n.id) AS ids
