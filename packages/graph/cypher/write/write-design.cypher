// Writes one write_design call in one query (contracts.md section 7, write_design):
// 1. Version check: the current design version (the highest designVersion among DocSections and
//    design nodes, or 0) must equal $baseVersion. A revision may write nodes only, so the nodes
//    count too. `current` stays a grouping key so no aggregation brings back a row.
// 2. Design nodes MERGE on key under their label (one FOREACH per label: Cypher has no dynamic
//    label), then get their fields, designVersion = $designVersion, version + 1 (a new node starts
//    at 1) and new DERIVED_FROM edges to their current Requirements.
// 3. DocSections MERGE on (doc, order), stale = false, with new RENDERS edges to the Requirements,
//    Features and design nodes their keys name.
// The query writes nothing when the version is old or a key it names is gone (a race).
// Nodes and sections left out are kept: a revision returns only what changes. Each part runs in
// its own CALL {}: in FalkorDB a MERGE or MATCH after a write and an aggregation in the same query
// part goes wrong.
OPTIONAL MATCH (cur {projectId: $projectId})
WHERE cur:DocSection OR cur:Decision OR cur:Component OR cur:Screen OR cur:DataEntity OR cur:Endpoint OR cur:Risk
WITH coalesce(max(cur.designVersion), 0) AS current
WHERE current = $baseVersion
// Every key the write names must still be there, checked before anything is written: each node's
// requirementKeys are current Requirements, and each section renders at least one known key.
OPTIONAL MATCH (rq:Requirement {projectId: $projectId})
WHERE rq.validTo IS NULL
WITH current, collect(rq.key) AS reqKeys
OPTIONAL MATCH (ft:Feature {projectId: $projectId})
WHERE ft.validTo IS NULL
WITH current, reqKeys, collect(ft.key) AS featureKeys
OPTIONAL MATCH (dn {projectId: $projectId})
WHERE dn:Decision OR dn:Component OR dn:Screen OR dn:DataEntity OR dn:Endpoint OR dn:Risk
WITH current, reqKeys, featureKeys, collect(dn.key) AS designKeys
WITH current, reqKeys, reqKeys + featureKeys + designKeys + [d IN $nodes | d.key] AS knownKeys
WHERE all(d IN $nodes WHERE all(k IN d.requirementKeys WHERE k IN reqKeys))
  AND all(s IN $sections WHERE any(k IN s.renders WHERE k IN knownKeys))
CALL {
  UNWIND $nodes AS d
  FOREACH (_ IN CASE WHEN d.label = 'Decision' THEN [1] ELSE [] END |
    MERGE (x:Decision {projectId: $projectId, key: d.key})
    ON CREATE SET x.id = d.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0)
  FOREACH (_ IN CASE WHEN d.label = 'Component' THEN [1] ELSE [] END |
    MERGE (x:Component {projectId: $projectId, key: d.key})
    ON CREATE SET x.id = d.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0)
  FOREACH (_ IN CASE WHEN d.label = 'Screen' THEN [1] ELSE [] END |
    MERGE (x:Screen {projectId: $projectId, key: d.key})
    ON CREATE SET x.id = d.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0)
  FOREACH (_ IN CASE WHEN d.label = 'DataEntity' THEN [1] ELSE [] END |
    MERGE (x:DataEntity {projectId: $projectId, key: d.key})
    ON CREATE SET x.id = d.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0)
  FOREACH (_ IN CASE WHEN d.label = 'Endpoint' THEN [1] ELSE [] END |
    MERGE (x:Endpoint {projectId: $projectId, key: d.key})
    ON CREATE SET x.id = d.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0)
  FOREACH (_ IN CASE WHEN d.label = 'Risk' THEN [1] ELSE [] END |
    MERGE (x:Risk {projectId: $projectId, key: d.key})
    ON CREATE SET x.id = d.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0)
  WITH d
  MATCH (n {projectId: $projectId, key: d.key})
  WHERE labels(n)[0] = d.label
  SET n.name = d.name, n.body = d.body, n.designVersion = $designVersion, n.version = n.version + 1
  FOREACH (_ IN CASE WHEN d.label = 'Endpoint' THEN [1] ELSE [] END |
    SET n.method = d.method, n.path = d.path)
  WITH n, d
  OPTIONAL MATCH (n)-[old:DERIVED_FROM]->(:Requirement)
  DELETE old
  WITH n, d, count(old) AS removed
  UNWIND d.requirementKeys AS reqKey
  MATCH (r:Requirement {projectId: $projectId, key: reqKey})
  WHERE r.validTo IS NULL
  CREATE (n)-[:DERIVED_FROM]->(r)
  WITH n, count(r) AS reqs
  RETURN collect([n.key, n.id, n.version]) AS nodes
}
CALL {
  UNWIND $sections AS s
  MERGE (x:DocSection {projectId: $projectId, doc: s.doc, order: s.order})
  ON CREATE SET x.id = s.id, x.createdBy = $createdBy, x.createdAt = $now, x.version = 0
  SET x.title = s.title, x.body = s.body, x.stale = false, x.designVersion = $designVersion,
    x.version = x.version + 1
  WITH x, s
  OPTIONAL MATCH (x)-[old:RENDERS]->()
  DELETE old
  WITH x, s, count(old) AS removed
  MATCH (t {projectId: $projectId})
  WHERE t.key IN s.renders AND t.validTo IS NULL
    AND (t:Requirement OR t:Feature OR t:Decision OR t:Component OR t:Screen OR t:DataEntity OR t:Endpoint OR t:Risk)
  CREATE (x)-[:RENDERS]->(t)
  WITH x, count(t) AS renders
  RETURN collect([x.doc, x.order, x.id, x.version]) AS sections
}
RETURN nodes, sections
