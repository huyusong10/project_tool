CREATE TABLE jira_prs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','running','completed','abandoned')),
  started_at TEXT,
  stop_requested INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX jira_pr_one_active ON jira_prs(project_id) WHERE state IN ('active','running');
--> statement-breakpoint
CREATE TABLE jira_progress_sync (
  project_id TEXT NOT NULL REFERENCES projects(id),
  progress_id TEXT NOT NULL REFERENCES progress_updates(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('pending','in_pr','synced','ignored')),
  pr_id TEXT REFERENCES jira_prs(id),
  comment_id TEXT,
  synced_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, progress_id)
);
--> statement-breakpoint
CREATE INDEX jira_progress_sync_pr ON jira_progress_sync(pr_id,state);
