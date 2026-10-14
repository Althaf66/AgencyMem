// Agency graph: anonymous lessons, case studies and estimate records. One attribute per statement.
CREATE INDEX FOR (n:EstimateRecord) ON (n.id);
CREATE INDEX FOR (n:Lesson) ON (n.id);
CREATE INDEX FOR (n:CaseStudy) ON (n.id);
CREATE INDEX FOR (n:Lesson) ON (n.featureKind);
CREATE INDEX FOR (n:Lesson) ON (n.clarityBand);
