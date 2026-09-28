CREATE TABLE jira_connections (
  account_id TEXT PRIMARY KEY NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  site TEXT NOT NULL, encrypted_token TEXT NOT NULL, version TEXT NOT NULL,
  verified_at TEXT, identity TEXT, problem TEXT, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE jira_project_settings (
  project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  settings TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE jira_bindings (
  requirement_id TEXT PRIMARY KEY NOT NULL REFERENCES requirements(id),
  project_id TEXT NOT NULL REFERENCES projects(id), site TEXT NOT NULL,
  issue_id TEXT NOT NULL, issue_key TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX jira_bindings_site_issue ON jira_bindings(site, issue_id);
--> statement-breakpoint
CREATE TABLE jira_ignored (
  project_id TEXT NOT NULL REFERENCES projects(id), site TEXT NOT NULL, issue_key TEXT NOT NULL,
  PRIMARY KEY (project_id, site, issue_key)
);
--> statement-breakpoint
CREATE TABLE jira_operations (
  id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id), credential_version TEXT NOT NULL,
  kind TEXT NOT NULL, state TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX jira_operations_owner ON jira_operations(account_id, project_id, kind);
