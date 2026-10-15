// Which of $ids are Episodes of the project (the source guard of write_fact).
UNWIND $ids AS id
MATCH (e:Episode {id: id, projectId: $projectId})
RETURN e.id AS id
