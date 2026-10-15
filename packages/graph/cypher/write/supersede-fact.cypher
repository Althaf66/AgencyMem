// record_change_request, write 1 (technical design "supersede-fact.cypher"): all or nothing. Only
// when the CR is open and every old fact is current: sets the CR status, ends each old fact and
// writes its replacement, which SUPERSEDES the old fact, is SOURCED_FROM the CR's episode and is
// ABOUT the old fact's entity; the CR ENDS the old fact. A fact is never deleted. One row when it
// wrote, none when it changed nothing.
MATCH (cr:ChangeRequest {id: $crId, projectId: $projectId})-[:FROM]->(e:Episode)
WHERE cr.status = 'open'
OPTIONAL MATCH (cur:Fact {projectId: $projectId})
WHERE cur.id IN [c IN $changes | c.oldFactId] AND cur.validTo IS NULL
WITH cr, e, collect(cur) AS olds
WHERE size(olds) = size($changes)
SET cr.status = $status, cr.version = cr.version + 1
FOREACH (old IN olds |
  FOREACH (c IN [x IN $changes WHERE x.oldFactId = old.id] |
    SET old.validTo = $now, old.version = old.version + 1
    CREATE (new:Fact {id: c.newFactId, projectId: $projectId, statement: c.statement,
      subject: old.subject, attribute: old.attribute, value: c.value, validFrom: $now,
      createdBy: $createdBy, createdAt: $now, version: 1})
    CREATE (new)-[:SUPERSEDES]->(old), (new)-[:SOURCED_FROM]->(e), (cr)-[:ENDS]->(old)))
WITH cr
OPTIONAL MATCH (n:Fact {projectId: $projectId})-[:SUPERSEDES]->(:Fact)-[:ABOUT]->(ent:Entity)
WHERE n.id IN [c IN $changes | c.newFactId]
FOREACH (x IN CASE WHEN n IS NULL THEN [] ELSE [1] END | CREATE (n)-[:ABOUT]->(ent))
WITH cr, count(n) AS about
RETURN cr.status AS status, about
