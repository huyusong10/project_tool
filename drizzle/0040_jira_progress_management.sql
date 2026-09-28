UPDATE jira_project_settings
SET settings=json_remove(settings,'$.statuses','$.rules','$.paths','$.writesEnabled'), version=version+1;
--> statement-breakpoint
DELETE FROM jira_operations WHERE kind='scan';
