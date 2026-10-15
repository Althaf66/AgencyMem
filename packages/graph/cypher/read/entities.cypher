// The project's Entities, for matching names and aliases (write_fact) and for recall_context.
MATCH (n:Entity {projectId: $projectId})
RETURN n.key AS key, n.name AS name, n.aliases AS aliases
ORDER BY n.key
