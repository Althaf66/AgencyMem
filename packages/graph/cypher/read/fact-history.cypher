// Every Fact of the project, current and ended, for the Memory screen's "what we knew then"
// (GET /api/projects/:id/memory). A fact is current from validFrom until validTo.
MATCH (f:Fact {projectId: $projectId})
RETURN f.id AS id, f.statement AS statement, f.validFrom AS validFrom, f.validTo AS validTo
ORDER BY f.validFrom, f.id
