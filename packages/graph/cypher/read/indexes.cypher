// The indexes of one graph: one row per label with its indexed properties.
CALL db.indexes() YIELD label, properties
RETURN label, properties
