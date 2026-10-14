// Registry graph: Client and Project nodes only. One attribute per statement, so a rerun that
// finds an index already there skips only that one.
CREATE INDEX FOR (n:Client) ON (n.id);
CREATE INDEX FOR (n:Project) ON (n.id);
