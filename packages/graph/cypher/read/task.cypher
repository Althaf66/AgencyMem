// One Task with what recall_context's `tasks` group holds: its requirement, the design nodes it
// uses, the cards it depends on, its criteria and the TestCases that verify them.
MATCH (t:Task {projectId: $projectId, id: $taskId})
OPTIONAL MATCH (t)-[:IMPLEMENTS]->(r:Requirement)
WITH t, collect(r.key)[0] AS requirementKey
OPTIONAL MATCH (t)-[:USES]->(d)
WITH t, requirementKey, collect(d.key) AS designKeys
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(x:Task)
WITH t, requirementKey, designKeys, collect(x.key) AS dependsOn
OPTIONAL MATCH (t)-[:HAS_CRITERION]->(k:AcceptanceCriterion)
WITH t, requirementKey, designKeys, dependsOn,
  collect(CASE WHEN k IS NULL THEN null
    ELSE {id: k.id, key: k.key, text: k.text, testIds: k.testIds} END) AS criteria
OPTIONAL MATCH (t)-[:HAS_CRITERION]->(vk:AcceptanceCriterion)<-[:VERIFIES]-(c:TestCase)
RETURN t.id AS id, t.key AS key, t.title AS title, t.description AS description, t.lane AS lane,
  t.column AS column, t.kind AS kind, t.version AS version, requirementKey, designKeys, dependsOn,
  criteria,
  collect(CASE WHEN c IS NULL THEN null
    ELSE {id: c.id, file: c.file, title: c.title, criterionKey: vk.key} END) AS testCases
