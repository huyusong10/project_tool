PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_issue_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_id` text NOT NULL,
	`progress` integer,
	`content` text NOT NULL,
	`created_by_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`issue_id`) REFERENCES `issues`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "issue_updates_progress_range" CHECK("__new_issue_updates"."progress" IS NULL OR ("__new_issue_updates"."progress" >= 0 AND "__new_issue_updates"."progress" <= 100))
);
--> statement-breakpoint
INSERT INTO `__new_issue_updates`("id", "issue_id", "progress", "content", "created_by_account_id", "created_at", "updated_at") SELECT "id", "issue_id", NULL, "content", NULL, "created_at", "updated_at" FROM `issue_updates`;--> statement-breakpoint
DROP TABLE `issue_updates`;--> statement-breakpoint
ALTER TABLE `__new_issue_updates` RENAME TO `issue_updates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_issue_updates_issue_created` ON `issue_updates` (`issue_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_issues` (
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
	`progress` integer DEFAULT 0 NOT NULL,
	`discovered_at` text NOT NULL,
	`due_date` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "issues_status_valid" CHECK("__new_issues"."status" IN ('open', 'in_progress', 'deferred', 'resolved')),
	CONSTRAINT "issues_priority_valid" CHECK("__new_issues"."priority" IN ('P0', 'P1', 'P2', 'P3')),
	CONSTRAINT "issues_progress_range" CHECK("__new_issues"."progress" >= 0 AND "__new_issues"."progress" <= 100)
);
--> statement-breakpoint
INSERT INTO `__new_issues`("id", "project_id", "requirement_id", "source_ref", "title", "impact", "reporter", "owner_id", "status", "priority", "progress", "discovered_at", "due_date", "resolved_at", "created_at", "updated_at") SELECT "id", "project_id", "requirement_id", "source_ref", "title", "impact", "reporter", "owner_id", "status", "priority", CASE WHEN "status"='resolved' OR "resolved_at" IS NOT NULL THEN 100 ELSE 0 END, "discovered_at", "due_date", "resolved_at", "created_at", "updated_at" FROM `issues`;--> statement-breakpoint
DROP TABLE `issues`;--> statement-breakpoint
ALTER TABLE `__new_issues` RENAME TO `issues`;--> statement-breakpoint
CREATE INDEX `idx_issues_project_status_due` ON `issues` (`project_id`,`status`,`due_date`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_issues_owner` ON `issues` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_requirement` ON `issues` (`requirement_id`);--> statement-breakpoint
CREATE TABLE `__new_progress_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`work_item_id` text,
	`percent` integer NOT NULL,
	`work_item_percent` integer,
	`content` text NOT NULL,
	`created_by_account_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "progress_updates_percent_range" CHECK("__new_progress_updates"."percent" >= 0 AND "__new_progress_updates"."percent" <= 100),
	CONSTRAINT "progress_updates_work_item_percent_range" CHECK("__new_progress_updates"."work_item_percent" IS NULL OR ("__new_progress_updates"."work_item_percent" >= 0 AND "__new_progress_updates"."work_item_percent" <= 100))
);
--> statement-breakpoint
INSERT INTO `__new_progress_updates`("id", "requirement_id", "work_item_id", "percent", "work_item_percent", "content", "created_by_account_id", "created_at", "updated_at") SELECT "id", "requirement_id", "work_item_id", "percent", NULL, "content", "created_by_account_id", "created_at", "updated_at" FROM `progress_updates`;--> statement-breakpoint
DROP TABLE `progress_updates`;--> statement-breakpoint
ALTER TABLE `__new_progress_updates` RENAME TO `progress_updates`;--> statement-breakpoint
CREATE INDEX `idx_progress_requirement_created` ON `progress_updates` (`requirement_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_work_items` (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`template_item_id` text,
	`title` text NOT NULL,
	`owner_id` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`planned_start` text,
	`planned_end` text,
	`actual_start` text,
	`actual_end` text,
	`forecast_end` text,
	`blocked_at` text,
	`blocked_reason` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_item_id`) REFERENCES `template_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_items_progress_range" CHECK("__new_work_items"."progress" >= 0 AND "__new_work_items"."progress" <= 100)
);
--> statement-breakpoint
INSERT INTO `__new_work_items`("id", "requirement_id", "template_item_id", "title", "owner_id", "status", "planned_start", "planned_end", "actual_start", "actual_end", "forecast_end", "blocked_at", "blocked_reason", "progress", "sort_order", "created_at", "updated_at") SELECT "id", "requirement_id", "template_item_id", "title", "owner_id", "status", "planned_start", "planned_end", "actual_start", "actual_end", "forecast_end", "blocked_at", "blocked_reason", CASE WHEN "status"='completed' OR "actual_end" IS NOT NULL THEN 100 ELSE 0 END, "sort_order", "created_at", "updated_at" FROM `work_items`;--> statement-breakpoint
DROP TABLE `work_items`;--> statement-breakpoint
ALTER TABLE `__new_work_items` RENAME TO `work_items`;--> statement-breakpoint
CREATE INDEX `idx_work_items_requirement_order` ON `work_items` (`requirement_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_work_items_status` ON `work_items` (`status`);--> statement-breakpoint
CREATE INDEX `idx_work_items_owner_schedule` ON `work_items` (`owner_id`,`planned_start`,`planned_end`);--> statement-breakpoint
WITH RECURSIVE `planned_days`(`work_item_id`,`day`,`planned_end`) AS (
	SELECT `id`,`planned_start`,`planned_end` FROM `work_items`
	WHERE `planned_start` IS NOT NULL AND `planned_end` IS NOT NULL
	UNION ALL
	SELECT `work_item_id`,date(`day`,'+1 day'),`planned_end` FROM `planned_days` WHERE `day`<`planned_end`
), `item_weights` AS (
	SELECT w.`id`,w.`requirement_id`,w.`progress`,MAX(1,COALESCE(SUM(CASE WHEN strftime('%w',d.`day`) NOT IN ('0','6') THEN 1 ELSE 0 END),0)) AS `weight`
	FROM `work_items` w LEFT JOIN `planned_days` d ON d.`work_item_id`=w.`id`
	WHERE w.`status`<>'cancelled'
	GROUP BY w.`id`,w.`requirement_id`,w.`progress`
), `requirement_progress` AS (
	SELECT `requirement_id`,ROUND(SUM(`weight`*`progress`)*1.0/SUM(`weight`)) AS `progress`
	FROM `item_weights` GROUP BY `requirement_id`
)
UPDATE `requirements` SET `progress`=COALESCE((SELECT `progress` FROM `requirement_progress` WHERE `requirement_id`=`requirements`.`id`),0);
