// The project's DocSections, of one document or ($doc null) of all three, each with the nodes it
// RENDERS: their label, id, key and text (a requirement's text, else the node's name). Route 20
// and recall_context for the architect kinds.
MATCH (s:DocSection {projectId: $projectId})
WHERE $doc IS NULL OR s.doc = $doc
OPTIONAL MATCH (s)-[:RENDERS]->(n)
RETURN s, collect(CASE WHEN n IS NULL THEN null
  ELSE {label: labels(n)[0], id: n.id, key: n.key, text: coalesce(n.text, n.name)} END) AS renders
ORDER BY s.doc, s.order
