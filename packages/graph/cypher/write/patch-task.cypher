// Route 13, a person's edit of a card (stage-machine.md section 6, H1 to H6) in one query. The
// gateway works out $props from the rules: the edited fields, a new column, attempts 0 (H6), and for
// the human-wins rule (section 8) a cleared lease. A null in $props removes that property. With
// $criteria (H3), criteria MERGE by key and a criterion left out loses its HAS_CRITERION edge; the
// node stays. The MERGEs come before the delete and its count: after an aggregation, FalkorDB MERGEs
// every key onto the first one's node (gotcha 2). No row back: the version was old, and nothing
// changed.
MATCH (t:Task {projectId: $projectId, id: $id})
WHERE t.version = $version
SET t += $props, t.version = t.version + 1
FOREACH (c IN coalesce($criteria, []) |
  MERGE (k:AcceptanceCriterion {projectId: $projectId, key: c.key})
  ON CREATE SET k.id = c.id, k.createdBy = $createdBy, k.createdAt = $now, k.version = 0
  SET k.text = c.text, k.testIds = c.testIds, k.version = k.version + 1
  MERGE (t)-[:HAS_CRITERION]->(k))
WITH t
OPTIONAL MATCH (t)-[old:HAS_CRITERION]->(k:AcceptanceCriterion)
WHERE $criteria IS NOT NULL AND NOT k.key IN [c IN $criteria | c.key]
DELETE old
WITH t, count(old) AS dropped
RETURN t.version AS version
