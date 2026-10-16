// One Run node for a build run's final step (route 30 with final: true). Like the Runs that
// complete-item writes, it holds the item id as a property and has no edge.
CREATE (r:Run)
SET r = $run
RETURN r.id AS id
