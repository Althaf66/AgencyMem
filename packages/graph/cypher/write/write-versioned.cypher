// Versioned write (technical design "Key Cypher queries"). No row back: the version was old, and
// nothing changed. Values in $props are scalars or arrays; null removes a property (C10).
MATCH (n {id: $id})
WHERE n.version = $version
SET n += $props, n.version = n.version + 1
RETURN n.version AS version
