// Route 16 with a focus: the nodes up to $depth hops from it, either direction. Variable-length
// bounds cannot be parameters, so the match takes 3 hops and filters by path length.
// ponytail: enumerates paths, not nodes; a dense project at depth 3 would want a BFS per hop.
// RECALLED edges (what an item read) stay out: they would pull most of the graph into one hop.
MATCH p = (f {id: $focus})-[*0..3]-(n)
WHERE length(p) <= $depth AND n.projectId = $projectId
  AND none(r IN relationships(p) WHERE type(r) = 'RECALLED')
WITH DISTINCT n
ORDER BY n.id
LIMIT $limit
RETURN properties(n) AS p, labels(n)[0] AS label
