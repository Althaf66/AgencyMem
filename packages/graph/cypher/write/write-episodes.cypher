// Writes one uploaded file in one query: its Document and, for a new file, all its Episodes with a
// PART_OF edge each. A file whose sha256 the project already has returns that Document and writes
// nothing (created = false). MERGE on project and sha256; a new Document takes $id.
MERGE (d:Document {projectId: $projectId, sha256: $sha256})
ON CREATE SET d.id = $id, d.name = $name, d.mime = $mime, d.uploadedAt = $now,
  d.status = $status, d.episodeCount = $episodeCount, d.wordCount = $wordCount, d.error = $error,
  d.createdBy = $createdBy, d.createdAt = $now, d.version = 1
WITH d, d.id = $id AS created
FOREACH (e IN CASE WHEN created THEN $episodes ELSE [] END |
  CREATE (:Episode {id: e.id, projectId: $projectId, kind: 'file_chunk', documentId: d.id,
    page: e.page, lineStart: e.lineStart, lineEnd: e.lineEnd, text: e.text,
    createdBy: $createdBy, createdAt: $now, version: 1})-[:PART_OF]->(d))
RETURN d, created
