// Moves a Project to another stage, only from the stage the caller saw (stage-machine.md section 1,
// rule 2), so a repeated or late effect changes nothing. No row back: the stage had moved on.
MATCH (p:Project {id: $projectId})
WHERE p.stage = $from
SET p.stage = $to, p.version = p.version + 1
RETURN p
