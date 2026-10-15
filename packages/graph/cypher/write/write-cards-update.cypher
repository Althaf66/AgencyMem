// Writes one write_cards call in update mode (replan) in one query (contracts.md section 7,
// write_cards):
// 1. Every card exists, is in Rework and has the version the caller sent, and every requirement is
//    current; else no row and nothing is written.
// 2. Each card gets its new fields and version + 1; its IMPLEMENTS, USES and DEPENDS_ON edges are
//    replaced, and a criterion left out loses its HAS_CRITERION edge (the node stays).
// 3. Criteria MERGE by key. No write or aggregation comes before that MERGE in its CALL: after one,
//    FalkorDB MERGEs every row onto the first row's node (gotcha 2).
// Each part runs in its own CALL {}: in FalkorDB a MATCH after a write and an aggregation in the
// same query part goes wrong.
OPTIONAL MATCH (x {projectId: $projectId})
WHERE (x:Task AND x.key IN [c IN $cards | c.key]) OR (x:Requirement AND x.validTo IS NULL)
WITH collect(CASE WHEN x:Task AND x.column = 'Rework'
    AND any(c IN $cards WHERE c.key = x.key AND c.version = x.version) THEN x.key END) AS ready,
  collect(CASE WHEN x:Requirement THEN x.key END) AS reqKeys
WHERE size(ready) = size($cards) AND all(c IN $cards WHERE c.requirementKey IN reqKeys)
// FalkorDB: aggregated values in scope break the MATCH inside the CALL below (gotcha 8).
WITH 1 AS checked
CALL {
  UNWIND $cards AS c
  MATCH (t:Task {projectId: $projectId, key: c.key})
  SET t.title = c.title, t.description = c.description, t.lane = c.lane, t.order = c.order,
    t.version = t.version + 1
  WITH t, c
  OPTIONAL MATCH (t)-[old:IMPLEMENTS|USES|DEPENDS_ON|HAS_CRITERION]->(o)
  WHERE NOT (o:AcceptanceCriterion AND o.key IN [x IN c.criteria | x.key])
  DELETE old
  WITH t, c, count(old) AS removed
  MATCH (r:Requirement {projectId: $projectId, key: c.requirementKey})
  WHERE r.validTo IS NULL
  CREATE (t)-[:IMPLEMENTS]->(r)
  WITH t, c
  OPTIONAL MATCH (n {projectId: $projectId})
  WHERE (n.key IN c.designKeys
      AND (n:Decision OR n:Component OR n:Screen OR n:DataEntity OR n:Endpoint OR n:Risk))
    OR (n:Task AND n.key IN c.dependsOn)
  FOREACH (d IN CASE WHEN n IS NOT NULL AND NOT n:Task THEN [n] ELSE [] END |
    CREATE (t)-[:USES]->(d))
  FOREACH (d IN CASE WHEN n IS NOT NULL AND n:Task THEN [n] ELSE [] END |
    CREATE (t)-[:DEPENDS_ON]->(d))
  WITH t, count(n) AS links
  RETURN collect([t.key, t.id, t.version]) AS tasks
}
CALL {
  UNWIND $cards AS c
  MATCH (t:Task {projectId: $projectId, key: c.key})
  UNWIND c.criteria AS x
  MERGE (k:AcceptanceCriterion {projectId: $projectId, key: x.key})
  ON CREATE SET k.id = x.id, k.createdBy = $createdBy, k.createdAt = $now, k.version = 0
  SET k.text = x.text, k.testIds = x.testIds, k.version = k.version + 1
  MERGE (t)-[:HAS_CRITERION]->(k)
  RETURN collect([k.key, k.id]) AS criteria
}
RETURN tasks, criteria, checked
