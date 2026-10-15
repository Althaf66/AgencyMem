// Route 31: a blocked WorkItem back to open with attempts 0 (stage-machine.md section 3). No row
// back: the item is not blocked.
MATCH (w:WorkItem {projectId: $projectId, id: $id})
WHERE w.status = 'blocked'
SET w.status = 'open', w.attempts = 0, w.version = w.version + 1
RETURN w
