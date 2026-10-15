// Answers one open Question in one query (stage-machine.md T5): the answer Episode ANSWERS the
// Question, the Question is answered, its Assumption confirmed (accepted) or rejected (own answer)
// and RESOLVED_BY the Episode, and its Contradiction, if any, resolved. Versions go up by 1.
// No row back: the version was old or the Question is not open, and nothing changed.
MATCH (q:Question {id: $questionId, projectId: $projectId})-[:ASSUMES]->(a:Assumption)
WHERE q.version = $version AND q.status = 'open'
OPTIONAL MATCH (q)-[:RAISED_ON]->(k:Contradiction)
WITH q, a, head(collect(k)) AS c
CREATE (e:Episode {id: $episodeId, projectId: $projectId, kind: 'answer', text: $text,
  createdBy: $createdBy, createdAt: $now, version: 1})-[:ANSWERS]->(q)
CREATE (a)-[:RESOLVED_BY]->(e)
SET q.status = 'answered', q.version = q.version + 1,
  a.status = $assumptionStatus, a.version = a.version + 1
FOREACH (x IN CASE WHEN c IS NULL THEN [] ELSE [c] END |
  SET x.status = 'resolved', x.version = x.version + 1)
RETURN q.version AS questionVersion, a.id AS assumptionId, a.version AS assumptionVersion,
  c.id AS contradictionId, c.version AS contradictionVersion
