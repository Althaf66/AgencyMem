// The project's CodeChange with this sha, if any: a diff is served only for the project's commits.
MATCH (c:CodeChange {projectId: $projectId, sha: $sha})
RETURN c.id AS id
LIMIT 1
