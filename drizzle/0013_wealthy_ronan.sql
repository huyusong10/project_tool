INSERT INTO `system_meta` (`key`,`value`,`created_at`,`updated_at`)
SELECT 'state-migration-0013-report', json_object(
  'workItems', (SELECT COUNT(*) FROM `work_items` WHERE
    (`actual_end` IS NOT NULL AND `status`<>'completed') OR
    (`actual_start` IS NOT NULL AND `status`='not_started') OR
    (`progress`>=100 AND `status`<>'completed') OR
    (`status`='completed' AND (`progress`<>100 OR `actual_end` IS NULL))),
  'requirements', (SELECT COUNT(*) FROM `requirements` WHERE
    (`status`='completed' AND `progress`<>100) OR (`status`<>'completed' AND `progress`>=100)),
  'issues', (SELECT COUNT(*) FROM `issues` WHERE
    (`status`='resolved' AND (`progress`<>100 OR `resolved_at` IS NULL)) OR
    (`status`<>'resolved' AND (`progress`>=100 OR `resolved_at` IS NOT NULL)) OR
    (`status`='deferred' AND `due_date` IS NOT NULL))
), datetime('now'), datetime('now')
ON CONFLICT(`key`) DO UPDATE SET `value`=excluded.`value`,`updated_at`=excluded.`updated_at`;--> statement-breakpoint
ALTER TABLE `issue_updates` ADD `event_type` text DEFAULT 'progress' NOT NULL;--> statement-breakpoint
ALTER TABLE `issue_updates` ADD `supersedes_id` text;--> statement-breakpoint
UPDATE `issue_updates` SET `event_type`=CASE WHEN `progress`=100 THEN 'resolve' WHEN `progress` IS NULL THEN 'note' ELSE 'progress' END;--> statement-breakpoint
UPDATE `issues` SET
  `status`=CASE
    WHEN `status`='resolved' OR `progress`>=100 OR `resolved_at` IS NOT NULL THEN 'resolved'
    WHEN `status`='deferred' THEN 'deferred'
    WHEN `progress`>0 THEN 'in_progress'
    ELSE 'open'
  END,
  `progress`=CASE WHEN `status`='resolved' OR `progress`>=100 OR `resolved_at` IS NOT NULL THEN 100 WHEN `progress`<0 THEN 0 WHEN `progress`>99 THEN 99 ELSE `progress` END,
  `due_date`=CASE WHEN `status`='deferred' THEN NULL ELSE `due_date` END,
  `resolved_at`=CASE WHEN `status`='resolved' OR `progress`>=100 OR `resolved_at` IS NOT NULL THEN COALESCE(`resolved_at`, substr(`updated_at`,1,10)) ELSE NULL END;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "issues_status_valid" CHECK("__new_issues"."status" IN ('open', 'in_progress', 'deferred', 'resolved')),
	CONSTRAINT "issues_priority_valid" CHECK("__new_issues"."priority" IN ('P0', 'P1', 'P2', 'P3')),
	CONSTRAINT "issues_progress_range" CHECK("__new_issues"."progress" >= 0 AND "__new_issues"."progress" <= 100),
	CONSTRAINT "issues_state_consistent" CHECK((
    ("__new_issues"."status" = 'resolved' AND "__new_issues"."progress" = 100 AND "__new_issues"."resolved_at" IS NOT NULL) OR
    ("__new_issues"."status" <> 'resolved' AND "__new_issues"."progress" < 100 AND "__new_issues"."resolved_at" IS NULL)
  )),
	CONSTRAINT "issues_open_progress_zero" CHECK("__new_issues"."status" <> 'open' OR "__new_issues"."progress" = 0),
	CONSTRAINT "issues_deferred_without_due_date" CHECK("__new_issues"."status" <> 'deferred' OR "__new_issues"."due_date" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_issues`("id", "project_id", "requirement_id", "source_ref", "title", "impact", "reporter", "owner_id", "status", "priority", "progress", "discovered_at", "due_date", "resolved_at", "version", "created_at", "updated_at") SELECT "id", "project_id", "requirement_id", "source_ref", "title", "impact", "reporter", "owner_id", "status", "priority", "progress", "discovered_at", "due_date", "resolved_at", 1, "created_at", "updated_at" FROM `issues`;--> statement-breakpoint
DROP TABLE `issues`;--> statement-breakpoint
ALTER TABLE `__new_issues` RENAME TO `issues`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_issues_project_status_due` ON `issues` (`project_id`,`status`,`due_date`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_issues_owner` ON `issues` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_issues_requirement` ON `issues` (`requirement_id`);--> statement-breakpoint
ALTER TABLE `progress_updates` ADD `event_type` text DEFAULT 'progress' NOT NULL;--> statement-breakpoint
ALTER TABLE `progress_updates` ADD `supersedes_id` text;--> statement-breakpoint
UPDATE `progress_updates` SET `event_type`=CASE WHEN `work_item_percent`=100 THEN 'complete' WHEN `work_item_percent` IS NULL THEN 'note' ELSE 'progress' END;--> statement-breakpoint
UPDATE `work_items` SET
  `status`=CASE
    WHEN `status`='cancelled' THEN 'cancelled'
    WHEN `actual_end` IS NOT NULL OR `progress`>=100 THEN 'completed'
    WHEN `blocked_at` IS NOT NULL OR `status`='blocked' THEN 'blocked'
    WHEN `actual_start` IS NOT NULL OR `progress`>0 OR `status`='in_progress' THEN 'in_progress'
    ELSE 'not_started'
  END,
  `progress`=CASE
    WHEN `status`='cancelled' THEN min(max(`progress`,0),99)
    WHEN `actual_end` IS NOT NULL OR `progress`>=100 THEN 100
    WHEN `actual_start` IS NOT NULL OR `progress`>0 OR `status` IN ('in_progress','blocked') THEN min(max(`progress`,0),99)
    ELSE 0
  END,
  `actual_start`=CASE
    WHEN `status`='cancelled' THEN `actual_start`
    WHEN `actual_end` IS NOT NULL OR `progress`>=100 OR `blocked_at` IS NOT NULL OR `status`='blocked' OR `actual_start` IS NOT NULL OR `progress`>0 OR `status`='in_progress'
      THEN COALESCE(`actual_start`,`actual_end`,substr(COALESCE(`blocked_at`,`updated_at`),1,10))
    ELSE NULL
  END,
  `actual_end`=CASE WHEN `status`<>'cancelled' AND (`actual_end` IS NOT NULL OR `progress`>=100) THEN COALESCE(`actual_end`,substr(`updated_at`,1,10)) ELSE NULL END,
  `blocked_at`=CASE WHEN `status`<>'cancelled' AND (`blocked_at` IS NOT NULL OR `status`='blocked') AND `actual_end` IS NULL AND `progress`<100 THEN COALESCE(`blocked_at`,`updated_at`) ELSE NULL END,
  `blocked_reason`=CASE WHEN `status`<>'cancelled' AND (`blocked_at` IS NOT NULL OR `status`='blocked') AND `actual_end` IS NULL AND `progress`<100 THEN COALESCE(`blocked_reason`,'迁移前阻塞记录') ELSE NULL END;--> statement-breakpoint
CREATE TABLE `__new_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`template_id` text,
	`title` text NOT NULL,
	`owner_id` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`planned_start` text,
	`planned_end` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`priority` text DEFAULT 'P2' NOT NULL,
	`accepted_at` text,
	`accepted_by_account_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `work_item_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "requirements_progress_range" CHECK("__new_requirements"."progress" >= 0 AND "__new_requirements"."progress" <= 100),
	CONSTRAINT "requirements_status_valid" CHECK("__new_requirements"."status" IN ('planning', 'not_started', 'in_progress', 'blocked', 'pending_acceptance', 'completed', 'cancelled')),
	CONSTRAINT "requirements_terminal_consistent" CHECK((
    ("__new_requirements"."status" = 'completed' AND "__new_requirements"."progress" = 100 AND "__new_requirements"."accepted_at" IS NOT NULL) OR
    ("__new_requirements"."status" = 'pending_acceptance' AND "__new_requirements"."progress" = 100 AND "__new_requirements"."accepted_at" IS NULL) OR
    ("__new_requirements"."status" = 'cancelled' AND "__new_requirements"."accepted_at" IS NULL) OR
    ("__new_requirements"."status" NOT IN ('completed', 'pending_acceptance', 'cancelled') AND "__new_requirements"."progress" < 100 AND "__new_requirements"."accepted_at" IS NULL)
  ))
);
--> statement-breakpoint
INSERT INTO `__new_requirements`("id", "project_id", "template_id", "title", "owner_id", "status", "planned_start", "planned_end", "progress", "risk_level", "priority", "accepted_at", "accepted_by_account_id", "version", "created_at", "updated_at", "deleted_at")
SELECT r."id", r."project_id", r."template_id", r."title", r."owner_id",
  CASE
    WHEN r."status"='cancelled' THEN 'cancelled'
    WHEN EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status<>'cancelled')
      AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status NOT IN ('completed','cancelled')) THEN 'completed'
    WHEN NOT EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status<>'cancelled')
      OR EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status<>'cancelled' AND (w.planned_start IS NULL OR w.planned_end IS NULL)) THEN 'planning'
    WHEN EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status='blocked') THEN 'blocked'
    WHEN EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status IN ('in_progress','completed')) THEN 'in_progress'
    ELSE 'not_started'
  END,
  r."planned_start", COALESCE((SELECT MAX(w.planned_end) FROM work_items w WHERE w.requirement_id=r.id AND w.status<>'cancelled'),r."planned_end"),
  CASE
    WHEN r."status"='cancelled' THEN min(max(r."progress",0),99)
    WHEN EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status<>'cancelled')
      AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status NOT IN ('completed','cancelled')) THEN 100
    ELSE min(max(r."progress",0),99)
  END,
  r."risk_level", r."priority",
  CASE WHEN r."status"<>'cancelled'
    AND EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status<>'cancelled')
    AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=r.id AND w.status NOT IN ('completed','cancelled'))
    THEN COALESCE((SELECT MAX(w.actual_end) FROM work_items w WHERE w.requirement_id=r.id AND w.status='completed'),substr(r."updated_at",1,10)) ELSE NULL END,
  NULL, 1, r."created_at", r."updated_at", r."deleted_at"
FROM `requirements` r;--> statement-breakpoint
DROP TABLE `requirements`;--> statement-breakpoint
ALTER TABLE `__new_requirements` RENAME TO `requirements`;--> statement-breakpoint
CREATE INDEX `idx_requirements_project_status` ON `requirements` (`project_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_requirements_template` ON `requirements` (`template_id`);--> statement-breakpoint
CREATE INDEX `idx_requirements_owner` ON `requirements` (`owner_id`);--> statement-breakpoint
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
	`milestone_label` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_item_id`) REFERENCES `template_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_items_progress_range" CHECK("__new_work_items"."progress" >= 0 AND "__new_work_items"."progress" <= 100),
	CONSTRAINT "work_items_status_valid" CHECK("__new_work_items"."status" IN ('not_started', 'in_progress', 'blocked', 'completed', 'cancelled')),
	CONSTRAINT "work_items_state_consistent" CHECK((
    ("__new_work_items"."status" = 'not_started' AND "__new_work_items"."progress" = 0 AND "__new_work_items"."actual_start" IS NULL AND "__new_work_items"."actual_end" IS NULL AND "__new_work_items"."blocked_at" IS NULL) OR
    ("__new_work_items"."status" = 'in_progress' AND "__new_work_items"."progress" < 100 AND "__new_work_items"."actual_start" IS NOT NULL AND "__new_work_items"."actual_end" IS NULL AND "__new_work_items"."blocked_at" IS NULL) OR
    ("__new_work_items"."status" = 'blocked' AND "__new_work_items"."progress" < 100 AND "__new_work_items"."actual_start" IS NOT NULL AND "__new_work_items"."actual_end" IS NULL AND "__new_work_items"."blocked_at" IS NOT NULL) OR
    ("__new_work_items"."status" = 'completed' AND "__new_work_items"."progress" = 100 AND "__new_work_items"."actual_start" IS NOT NULL AND "__new_work_items"."actual_end" IS NOT NULL AND "__new_work_items"."blocked_at" IS NULL) OR
    ("__new_work_items"."status" = 'cancelled' AND "__new_work_items"."progress" < 100 AND "__new_work_items"."actual_end" IS NULL AND "__new_work_items"."blocked_at" IS NULL)
  ))
);
--> statement-breakpoint
INSERT INTO `__new_work_items`("id", "requirement_id", "template_item_id", "title", "owner_id", "status", "planned_start", "planned_end", "actual_start", "actual_end", "forecast_end", "blocked_at", "blocked_reason", "milestone_label", "progress", "sort_order", "version", "created_at", "updated_at") SELECT "id", "requirement_id", "template_item_id", "title", "owner_id", "status", "planned_start", "planned_end", "actual_start", "actual_end", "forecast_end", "blocked_at", "blocked_reason", "milestone_label", "progress", "sort_order", 1, "created_at", "updated_at" FROM `work_items`;--> statement-breakpoint
DROP TABLE `work_items`;--> statement-breakpoint
ALTER TABLE `__new_work_items` RENAME TO `work_items`;--> statement-breakpoint
CREATE INDEX `idx_work_items_requirement_order` ON `work_items` (`requirement_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_work_items_status` ON `work_items` (`status`);--> statement-breakpoint
CREATE INDEX `idx_work_items_owner_schedule` ON `work_items` (`owner_id`,`planned_start`,`planned_end`);--> statement-breakpoint
INSERT INTO `progress_updates` (`id`,`requirement_id`,`work_item_id`,`percent`,`work_item_percent`,`content`,`event_type`,`created_by_account_id`,`created_at`,`updated_at`)
SELECT lower(hex(randomblob(16))),r.id,NULL,100,NULL,'迁移前已完成，系统视为已验收','accept',NULL,r.accepted_at,r.accepted_at
FROM requirements r
WHERE r.status='completed' AND NOT EXISTS(SELECT 1 FROM progress_updates u WHERE u.requirement_id=r.id AND u.event_type='accept');
