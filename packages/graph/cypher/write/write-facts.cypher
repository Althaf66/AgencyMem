// Writes one write_fact call in one query: the Entities (MERGE on key; the gateway has already
// matched names and aliases and sends the full alias list), each Fact with ABOUT its Entity and
// SOURCED_FROM its Episodes, and for a replaced fact: validTo on the old one and SUPERSEDES to it.
UNWIND $entities AS en
MERGE (e:Entity {projectId: $projectId, key: en.key})
ON CREATE SET e.id = en.id, e.name = en.name, e.aliases = en.aliases,
  e.createdBy = $createdBy, e.createdAt = $now, e.version = 1
ON MATCH SET e.version = CASE WHEN e.aliases = en.aliases THEN e.version ELSE e.version + 1 END,
  e.aliases = en.aliases
WITH collect(e.id) AS entityIds
UNWIND $facts AS f
MATCH (n:Entity {projectId: $projectId, key: f.subject})
CREATE (x:Fact {id: f.id, projectId: $projectId, statement: f.statement, subject: f.subject,
  attribute: f.attribute, value: f.value, validFrom: $now,
  createdBy: $createdBy, createdAt: $now, version: 1})-[:ABOUT]->(n)
WITH entityIds, f, x
UNWIND f.episodeIds AS episodeId
MATCH (ep:Episode {id: episodeId, projectId: $projectId})
CREATE (x)-[:SOURCED_FROM]->(ep)
WITH entityIds, f.replacesFactId AS replaces, x, count(ep) AS sources
OPTIONAL MATCH (old:Fact {id: replaces, projectId: $projectId})
WHERE old.validTo IS NULL
FOREACH (o IN CASE WHEN old IS NULL THEN [] ELSE [old] END |
  SET o.validTo = $now, o.version = o.version + 1
  CREATE (x)-[:SUPERSEDES]->(o))
RETURN entityIds, collect(CASE WHEN old IS NULL THEN null ELSE [old.id, x.id] END) AS superseded
