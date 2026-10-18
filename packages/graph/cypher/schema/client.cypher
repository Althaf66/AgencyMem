// Client graph (client_<clientId>): a range index on id for every label. One attribute per statement.
CREATE INDEX FOR (n:Document) ON (n.id);
CREATE INDEX FOR (n:Episode) ON (n.id);
CREATE INDEX FOR (n:Entity) ON (n.id);
CREATE INDEX FOR (n:Fact) ON (n.id);
CREATE INDEX FOR (n:Contradiction) ON (n.id);
CREATE INDEX FOR (n:Question) ON (n.id);
CREATE INDEX FOR (n:Assumption) ON (n.id);
CREATE INDEX FOR (n:Requirement) ON (n.id);
CREATE INDEX FOR (n:Feature) ON (n.id);
CREATE INDEX FOR (n:Estimate) ON (n.id);
CREATE INDEX FOR (n:AcceptanceCriterion) ON (n.id);
CREATE INDEX FOR (n:ChangeRequest) ON (n.id);
CREATE INDEX FOR (n:Decision) ON (n.id);
CREATE INDEX FOR (n:Component) ON (n.id);
CREATE INDEX FOR (n:Screen) ON (n.id);
CREATE INDEX FOR (n:DataEntity) ON (n.id);
CREATE INDEX FOR (n:Endpoint) ON (n.id);
CREATE INDEX FOR (n:Risk) ON (n.id);
CREATE INDEX FOR (n:DocSection) ON (n.id);
CREATE INDEX FOR (n:Gate) ON (n.id);
CREATE INDEX FOR (n:WorkItem) ON (n.id);
CREATE INDEX FOR (n:Task) ON (n.id);
CREATE INDEX FOR (n:TestCase) ON (n.id);
CREATE INDEX FOR (n:TestRun) ON (n.id);
CREATE INDEX FOR (n:CodeChange) ON (n.id);
CREATE INDEX FOR (n:Run) ON (n.id);
CREATE INDEX FOR (n:ReadinessReport) ON (n.id);

// Technical design "Indexes": Fact(subject, attribute), Task(column), Episode(documentId), CodeChange(sha)
CREATE INDEX FOR (n:Fact) ON (n.subject);
CREATE INDEX FOR (n:Fact) ON (n.attribute);
CREATE INDEX FOR (n:Task) ON (n.column);
CREATE INDEX FOR (n:Episode) ON (n.documentId);
CREATE INDEX FOR (n:CodeChange) ON (n.sha);

// contracts.md section 4 "Extra indexes": WorkItem(kind, status), Requirement(key), Feature(key), Task(key)
CREATE INDEX FOR (n:WorkItem) ON (n.kind);
CREATE INDEX FOR (n:WorkItem) ON (n.status);
CREATE INDEX FOR (n:Requirement) ON (n.key);
CREATE INDEX FOR (n:Feature) ON (n.key);
CREATE INDEX FOR (n:Task) ON (n.key);
