// What an intake_answer item reads (agent-prompts.md section 2): the answer Episode, the Question it
// answers, and the facts that Question is raised on (through its Contradiction for a contradiction),
// each with its episodes and, once superseded, the fact that replaced it.
MATCH (e:Episode {id: $episodeId, projectId: $projectId})-[:ANSWERS]->(q:Question)
MATCH (q)-[:ASSUMES]->(a:Assumption)
OPTIONAL MATCH (q)-[:RAISED_ON]->(c:Contradiction)
OPTIONAL MATCH (q)-[:RAISED_ON]->(direct:Fact)
OPTIONAL MATCH (c)-[:BETWEEN]->(between:Fact)
WITH e, q, a, collect(DISTINCT direct) + collect(DISTINCT between) AS facts
UNWIND facts AS f
OPTIONAL MATCH (f)-[:SOURCED_FROM]->(src:Episode)
OPTIONAL MATCH (newer:Fact)-[:SUPERSEDES]->(f)
WITH e, q, a, f, collect(DISTINCT src.id) AS episodeIds, collect(DISTINCT newer.id) AS newer
WITH e, q, a, collect({id: f.id, statement: f.statement, subject: f.subject,
  attribute: f.attribute, value: f.value, episodeIds: episodeIds, validTo: f.validTo,
  replacedBy: head(newer)}) AS facts
RETURN {id: e.id, kind: e.kind, documentName: null, page: null, lineStart: null, lineEnd: null,
    text: e.text} AS episode,
  {id: q.id, kind: q.kind, text: q.text, recommended: q.recommended, status: q.status,
    factIds: [x IN facts | x.id], assumption: {id: a.id, text: a.text, status: a.status},
    answer: {episodeId: e.id, text: e.text}} AS question,
  facts
