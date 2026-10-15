// Route 12, the agent strip: the project's WorkItems that are open, claimed or blocked, and the
// done ones newest first (the gateway keeps five).
MATCH (w:WorkItem {projectId: $projectId})
WHERE w.status IN ['open', 'claimed', 'blocked', 'done']
RETURN w
ORDER BY w.createdAt
