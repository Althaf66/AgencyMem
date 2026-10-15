// The project's Questions for route 8 (QuestionView): each with its Assumption, its Contradiction,
// its answer Episode (task 2.7), and the Episode behind each of its facts (through the
// Contradiction for a contradiction).
// Contradictions first, then open questions, then unclear points; oldest first within each.
MATCH (q:Question {projectId: $projectId})-[:ASSUMES]->(a:Assumption)
OPTIONAL MATCH (q)-[:RAISED_ON]->(c:Contradiction)
OPTIONAL MATCH (ans:Episode)-[:ANSWERS]->(q)
OPTIONAL MATCH (q)-[:RAISED_ON]->(direct:Fact)
OPTIONAL MATCH (c)-[:BETWEEN]->(between:Fact)
WITH q, a, c, ans, collect(DISTINCT direct) + collect(DISTINCT between) AS facts
UNWIND facts AS f
MATCH (f)-[:SOURCED_FROM]->(e:Episode)
OPTIONAL MATCH (e)-[:PART_OF]->(d:Document)
WITH q, a, c, ans, collect({episodeId: e.id, factId: f.id, factStatement: f.statement,
  documentName: d.name, page: e.page, lineStart: e.lineStart, lineEnd: e.lineEnd,
  text: e.text}) AS sources
RETURN q, a, c, sources,
  CASE WHEN ans IS NULL THEN null
    ELSE {episodeId: ans.id, text: ans.text, actor: ans.createdBy, at: ans.createdAt} END AS answer
ORDER BY CASE q.kind WHEN 'contradiction' THEN 0 WHEN 'open' THEN 1 ELSE 2 END, q.createdAt, q.id
