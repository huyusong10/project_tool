PRAGMA foreign_keys=OFF;--> statement-breakpoint
UPDATE `issues` SET `status`='in_progress' WHERE `status`='open';--> statement-breakpoint
CREATE TABLE `__new_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text,
	`source_ref` text,
	`title` text NOT NULL,
	`impact` text,
	`reporter` text,
	`owner_id` text,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`priority` text DEFAULT 'P2' NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`discovered_at` text NOT NULL,
	`due_date` text,
	`resolved_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "issues_status_valid" CHECK("__new_issues"."status" IN ('in_progress', 'deferred', 'resolved')),
	CONSTRAINT "issues_priority_valid" CHECK("__new_issues"."priority" IN ('P0', 'P1', 'P2', 'P3')),
	CONSTRAINT "issues_progress_range" CHECK("__new_issues"."progress" >= 0 AND "__new_issues"."progress" <= 100),
	CONSTRAINT "issues_state_consistent" CHECK((
    ("__new_issues"."status" = 'resolved' AND "__new_issues"."progress" = 100 AND "__new_issues"."resolved_at" IS NOT NULL) OR
    ("__new_issues"."status" <> 'resolved' AND "__new_issues"."progress" < 100 AND "__new_issues"."resolved_at" IS NULL)
  )),
	CONSTRAINT "issues_deferred_without_due_date" CHECK("__new_issues"."status" <> 'deferred' OR "__new_issues"."due_date" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_issues`("id", "project_id", "requirement_id", "source_ref", "title", "impact", "reporter", "owner_id", "status", "priority", "progress", "discovered_at", "due_date", "resolved_at", "version", "created_at", "updated_at") SELECT "id", "project_id", "requirement_id", "source_ref", "title", "impact", "reporter", "owner_id", "status", "priority", "progress", "discovered_at", "due_date", "resolved_at", "version", "created_at", "updated_at" FROM `issues`;--> statement-breakpoint
DROP TABLE `issues`;--> statement-breakpoint
ALTER TABLE `__new_issues` RENAME TO `issues`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_issues_project_status_due` ON `issues` (`project_id`,`status`,`due_date`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_issues_owner` ON `issues` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_requirement` ON `issues` (`requirement_id`);
