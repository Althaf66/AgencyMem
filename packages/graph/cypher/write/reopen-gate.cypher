// Sets a rejected Gate back to waiting (stage-machine.md T8: the revision after a G2 rejection is
// done). Its reason stays, so the gate panel still shows what the revision answers. Checks the old
// status, so running it twice changes nothing (section 1, rule 2). No row back: not rejected.
MATCH (g:Gate {projectId: $projectId, key: $key})
WHERE g.status = 'rejected'
SET g.status = 'waiting', g.version = g.version + 1
RETURN g
