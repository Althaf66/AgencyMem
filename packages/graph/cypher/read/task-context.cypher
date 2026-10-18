// Everything a build run needs for one card (get_task_context, contracts.md section 7): the card,
// its requirement and current facts, criteria, design nodes, TestCases, CodeChanges, the source
// episodes with their document names. Pattern comprehensions on the
// one card node, with no aggregation: grouping on missing properties breaks FalkorDB.
MATCH (t:Task {projectId: $projectId, id: $taskId})
RETURN t,
  [(t)-[:IMPLEMENTS]->(r:Requirement) | {key: r.key, text: r.text}] AS requirements,
  [(t)-[:IMPLEMENTS]->(:Requirement)-[:DERIVED_FROM]->(f:Fact) WHERE f.validTo IS NULL |
    {id: f.id, statement: f.statement}] AS facts,
  [(t)-[:HAS_CRITERION]->(k:AcceptanceCriterion) | {key: k.key, text: k.text, testIds: k.testIds}]
    AS criteria,
  [(t)-[:USES]->(n) | {label: labels(n)[0], key: n.key, name: n.name, body: n.body,
    method: n.method, path: n.path}] AS design,
  [(t)-[:HAS_CRITERION]->(k:AcceptanceCriterion)<-[:VERIFIES]-(c:TestCase) |
    {file: c.file, title: c.title, criterionKey: k.key}] AS testCases,
  [(c:CodeChange)-[:FOR_TASK]->(t) |
    {sha: c.sha, message: c.message, files: c.files, committedAt: c.committedAt}] AS codeChanges,
  [(t)-[:IMPLEMENTS]->(:Requirement)-[:DERIVED_FROM]->(f:Fact)-[:SOURCED_FROM]->(e:Episode)
    WHERE f.validTo IS NULL |
    {id: e.id, page: e.page, lineStart: e.lineStart, lineEnd: e.lineEnd, text: e.text,
     createdAt: e.createdAt}] AS episodes,
  [(t)-[:IMPLEMENTS]->(:Requirement)-[:DERIVED_FROM]->(:Fact)-[:SOURCED_FROM]->(e:Episode)
    -[:PART_OF]->(d:Document) | {id: e.id, name: d.name}] AS documents
