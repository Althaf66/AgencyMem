// Route 18 (impact): impact.cypher with its paths, so the panel can draw the links from a fact to
// every node derived from it. Same shape as why.cypher.
MATCH (n {id: $id})
OPTIONAL MATCH p = (n)<-[:DERIVED_FROM|OF|IMPLEMENTS|USES|HAS_CRITERION|VERIFIES|RENDERS*1..6]-()
WITH n, collect(p) AS ps
RETURN properties(n) AS p, labels(n)[0] AS label,
  [q IN ps | [x IN nodes(q) | {p: properties(x), label: labels(x)[0]}]] AS nodes,
  [q IN ps | [r IN relationships(q) | {source: startNode(r).id, target: endNode(r).id, type: type(r)}]] AS links
