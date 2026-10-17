// The Read view: one WorkItem or Task and every node it read (its RECALLED edges), as one path.
// Same row shape as why.cypher: api/graph.ts merges the lists.
MATCH (i {id: $id})
OPTIONAL MATCH (i)-[:RECALLED]->(n)
WITH i, collect(n) AS ns
RETURN properties(i) AS p, labels(i)[0] AS label,
  [[x IN ns | {p: properties(x), label: labels(x)[0]}]] AS nodes,
  [[x IN ns | {source: i.id, target: x.id, type: 'RECALLED'}]] AS links
