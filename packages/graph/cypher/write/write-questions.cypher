// Writes one write_question call in one query: each Question (open) with its Assumption (ASSUMES);
// for a contradiction a Contradiction BETWEEN its facts with the Question RAISED_ON it; for the
// other kinds the Question RAISED_ON its facts.
// The new Question is carried in `x`, never matched again by id: FalkorDB does not find a node by
// its properties later in the query that created it with an edge (checked on falkordb:latest).
UNWIND $questions AS q
CREATE (x:Question {id: q.id, projectId: $projectId, kind: q.kind, text: q.text,
  recommended: q.recommended, reasoning: q.reasoning, approach: q.approach, status: 'open',
  createdBy: $createdBy, createdAt: $now, version: 1})-[:ASSUMES]->(:Assumption {
  id: q.assumptionId, projectId: $projectId, text: q.assumption, status: 'open',
  createdBy: $createdBy, createdAt: $now, version: 1})
FOREACH (c IN CASE WHEN q.contradiction IS NULL THEN [] ELSE [q.contradiction] END |
  CREATE (x)-[:RAISED_ON]->(:Contradiction {id: c.id, projectId: $projectId, summary: c.summary,
    status: 'open', createdBy: $createdBy, createdAt: $now, version: 1}))
WITH x, q
OPTIONAL MATCH (x)-[:RAISED_ON]->(k:Contradiction)
WITH x, q, k
UNWIND q.factIds AS factId
MATCH (f:Fact {id: factId, projectId: $projectId})
WHERE f.validTo IS NULL
FOREACH (_ IN CASE WHEN k IS NULL THEN [1] ELSE [] END | CREATE (x)-[:RAISED_ON]->(f))
FOREACH (_ IN CASE WHEN k IS NULL THEN [] ELSE [1] END | CREATE (k)-[:BETWEEN]->(f))
RETURN count(*) AS edges
