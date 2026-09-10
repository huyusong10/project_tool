CREATE TABLE requirement_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','closed')),
  source TEXT NOT NULL CHECK(source IN ('web','mcp')),
  receipt TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX requirement_drafts_owner_updated ON requirement_drafts(account_id, updated_at);
--> statement-breakpoint
CREATE TABLE requirement_draft_requests (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  request_id TEXT NOT NULL,
  draft_id TEXT NOT NULL REFERENCES requirement_drafts(id),
  kind TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(account_id,request_id)
);
