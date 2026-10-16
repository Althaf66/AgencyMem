// Route 17 (why): from one node along the source edges forward to the Episodes it comes from
// (technical design "Edges": they point from the derived node to its source). One list of nodes
// and one list of links per path; api/graph.ts merges them.
// ponytail: enumerates every path up to 8 hops; fine for one project, bound it if a node fans out.
MATCH (n {id: $id})
OPTIONAL MATCH p = (n)-[:SOURCED_FROM|DERIVED_FROM|IMPLEMENTS|USES|HAS_CRITERION|OF|HAS_REQUIREMENT|FOR|RENDERS|VERIFIES|RUNS|FOR_TASK|CAUSED_BY|RAISED_ON|BETWEEN|ASSUMES|RESOLVED_BY|FROM*1..8]->(:Episode)
WITH n, collect(p) AS ps
RETURN properties(n) AS p, labels(n)[0] AS label,
  [q IN ps | [x IN nodes(q) | {p: properties(x), label: labels(x)[0]}]] AS nodes,
  [q IN ps | [r IN relationships(q) | {source: startNode(r).id, target: endNode(r).id, type: type(r)}]] AS links
