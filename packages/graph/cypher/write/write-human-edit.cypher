// Route 21 before G3 (stage-machine.md T12): the human_edit Episode with the person's words.
CREATE (e:Episode {id: $id, projectId: $projectId, kind: 'human_edit', text: $text,
  createdBy: $createdBy, createdAt: $now, version: 1})
RETURN e
