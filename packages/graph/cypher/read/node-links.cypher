// Route 6: one node with its label, and every edge to or from it with the other node's label and
// the properties its title is made from (api/nodes.ts).
MATCH (n {id: $id})
OPTIONAL MATCH (n)-[r]->(o)
WITH n, collect(CASE WHEN o IS NULL THEN null ELSE {type: type(r), direction: 'out', other: {
  id: o.id, label: labels(o)[0], kind: o.kind, page: o.page, lineStart: o.lineStart,
  lineEnd: o.lineEnd, name: o.name, statement: o.statement, text: o.text, key: o.key,
  title: o.title}} END) AS outs
OPTIONAL MATCH (n)<-[r2]-(i)
WITH n, outs, collect(CASE WHEN i IS NULL THEN null ELSE {type: type(r2), direction: 'in', other: {
  id: i.id, label: labels(i)[0], kind: i.kind, page: i.page, lineStart: i.lineStart,
  lineEnd: i.lineEnd, name: i.name, statement: i.statement, text: i.text, key: i.key,
  title: i.title}} END) AS ins
RETURN n, labels(n)[0] AS label, outs + ins AS links
