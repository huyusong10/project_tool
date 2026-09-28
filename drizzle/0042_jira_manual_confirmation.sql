ALTER TABLE jira_progress_sync ADD COLUMN manual_account_id TEXT;
--> statement-breakpoint
ALTER TABLE jira_progress_sync ADD COLUMN manual_reason TEXT;
--> statement-breakpoint
ALTER TABLE jira_progress_sync ADD COLUMN manual_url TEXT;
