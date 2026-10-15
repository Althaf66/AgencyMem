// Writes one write_cards call in create mode in one query (contracts.md section 7, write_cards):
// 1. No Task of the project has one of $keys yet, and every card's requirement is current; else
//    no row and nothing is written.
// 2. Each card becomes a build Task in Backlog that IMPLEMENTS its Requirement, USES the design
//    nodes its designKeys name, and HAS_CRITERION its new AcceptanceCriteria.
// 3. DEPENDS_ON edges between the new Tasks ($edges holds their ids).
// Each part runs in its own CALL {}: in FalkorDB a MATCH after a write and an aggregation in the
// same query part goes wrong.
// ponytail: x here and d below match with no label, so they scan the project's nodes; fine for
// one planner write per project. Split by label if a project ever holds thousands of nodes.
OPTIONAL MATCH (x {projectId: $projectId})
WHERE (x:Task AND x.key IN $keys) OR (x:Requirement AND x.validTo IS NULL)
WITH sum(CASE WHEN x:Task THEN 1 ELSE 0 END) AS existing,
  collect(CASE WHEN x:Requirement THEN x.key END) AS reqKeys
WHERE existing = 0 AND all(c IN $cards WHERE c.requirementKey IN reqKeys)
// FalkorDB: with the aggregated values still in scope, the MATCH inside the CALL below fails with
// "Variable r not found". Projecting them away first avoids it.
WITH 1 AS checked
CALL {
  UNWIND $cards AS c
  MATCH (r:Requirement {projectId: $projectId, key: c.requirementKey})
  WHERE r.validTo IS NULL
  CREATE (t:Task {id: c.id, projectId: $projectId, key: c.key, title: c.title,
    description: c.description, lane: c.lane, column: 'Backlog', order: c.order, kind: 'build',
    attempts: 0, createdBy: $createdBy, createdAt: $now, version: 1})
  CREATE (t)-[:IMPLEMENTS]->(r)
  FOREACH (k IN c.criteria |
    CREATE (t)-[:HAS_CRITERION]->(:AcceptanceCriterion {id: k.id, projectId: $projectId,
      key: k.key, text: k.text, testIds: k.testIds, createdBy: $createdBy, createdAt: $now,
      version: 1}))
  WITH t, c
  OPTIONAL MATCH (d {projectId: $projectId})
  WHERE d.key IN c.designKeys
    AND (d:Decision OR d:Component OR d:Screen OR d:DataEntity OR d:Endpoint OR d:Risk)
  FOREACH (n IN CASE WHEN d IS NULL THEN [] ELSE [d] END | CREATE (t)-[:USES]->(n))
  WITH t, count(d) AS uses
  RETURN collect([t.key, t.id]) AS tasks
}
CALL {
  UNWIND $edges AS e
  MATCH (a:Task {id: e.from}), (b:Task {id: e.to})
  CREATE (a)-[:DEPENDS_ON]->(b)
  RETURN count(b) AS dependencies
}
RETURN tasks, dependencies, checked
