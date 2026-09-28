CREATE TABLE jira_reference_only (
  requirement_id TEXT NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  site TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  PRIMARY KEY (requirement_id, site, issue_id)
);
