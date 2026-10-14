// What a fact touches (technical design "Key Cypher queries", impact.cypher): every node derived
// from it, following the source edges backward.
MATCH (f:Fact {id: $factId})<-[:DERIVED_FROM|OF|IMPLEMENTS|USES|HAS_CRITERION|VERIFIES|RENDERS*1..6]-(n)
RETURN DISTINCT labels(n)[0] AS type, n.id AS id, coalesce(n.key, n.title, n.name) AS label
