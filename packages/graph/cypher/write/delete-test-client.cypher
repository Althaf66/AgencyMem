// Test cleanup only: removes a test client from the registry with its Projects. The name guard
// means no real client can ever be removed this way.
MATCH (c:Client {id: $clientId})
WHERE c.name STARTS WITH 'test-client-'
OPTIONAL MATCH (p:Project {clientId: c.id})
WITH c, collect(p) AS projects
FOREACH (p IN projects | DELETE p)
DELETE c
RETURN size(projects) AS projects
