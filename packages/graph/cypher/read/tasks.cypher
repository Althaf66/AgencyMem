// The keys of the project's Tasks (write_cards refuses a key that exists).
MATCH (t:Task {projectId: $projectId})
RETURN t.key AS key
ORDER BY t.key
