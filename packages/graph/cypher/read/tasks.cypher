// The project's Tasks with their column, version and the cards they depend on: write_cards refuses
// a key that exists (create), a card that is not in Rework or an old version (update), and a cycle.
MATCH (t:Task {projectId: $projectId})
OPTIONAL MATCH (t)-[:DEPENDS_ON]->(d:Task)
RETURN t.key AS key, t.column AS column, t.version AS version, collect(d.key) AS dependsOn
ORDER BY key
