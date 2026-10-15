// The project's Documents in upload order (route 5). Document ids are monotonic ULIDs, so they
// order the files of one upload, which share uploadedAt.
MATCH (d:Document {projectId: $projectId})
RETURN d
ORDER BY d.uploadedAt, d.id
