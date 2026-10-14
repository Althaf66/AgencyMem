// Any node by id, with its label: the facts the tenancy and lease guards need.
MATCH (n {id: $id})
RETURN n, labels(n)[0] AS label
