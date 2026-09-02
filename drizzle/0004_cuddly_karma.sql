CREATE TABLE `issue_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_issue_updates_issue_created` ON `issue_updates` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text,
	`source_ref` text,
	`title` text NOT NULL,
	`impact` text,
	`reporter` text,
	`owner_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'P2' NOT NULL,
	`discovered_at` text NOT NULL,
	`due_date` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "issues_status_valid" CHECK("issues"."status" IN ('open', 'in_progress', 'deferred', 'resolved')),
	CONSTRAINT "issues_priority_valid" CHECK("issues"."priority" IN ('P0', 'P1', 'P2', 'P3'))
);
--> statement-breakpoint
CREATE INDEX `idx_issues_project_status_due` ON `issues` (`project_id`,`status`,`due_date`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_issues_owner` ON `issues` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_requirement` ON `issues` (`requirement_id`);