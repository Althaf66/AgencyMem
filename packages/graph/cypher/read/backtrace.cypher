// Route 19 (technical design, backtrace.cypher): from a Defect forward along CAUSED_BY, FOR_TASK,
// IMPLEMENTS, DERIVED_FROM and SOURCED_FROM to the client's Episodes: Defect -> CodeChange -> Task
// -> Requirement -> Fact -> Episode. Same shape as why.cypher; api/graph.ts merges the paths.
MATCH (n {id: $id})
OPTIONAL MATCH p = (n)-[:CAUSED_BY|FOR_TASK|IMPLEMENTS|DERIVED_FROM|SOURCED_FROM*1..8]->(:Episode)
WITH n, collect(p) AS ps
RETURN properties(n) AS p, labels(n)[0] AS label,
  [q IN ps | [x IN nodes(q) | {p: properties(x), label: labels(x)[0]}]] AS nodes,
  [q IN ps | [r IN relationships(q) | {source: startNode(r).id, target: endNode(r).id, type: type(r)}]] AS links
