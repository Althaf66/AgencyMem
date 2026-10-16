// Writes why a card could not close onto the card itself (an evidence rejection, so the board shows
// the reason on the card). Version + 1, like any change.
MATCH (t:Task {projectId: $projectId, id: $taskId})
SET t.note = $note, t.version = t.version + 1
RETURN t.version AS version
