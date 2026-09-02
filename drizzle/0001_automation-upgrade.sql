ALTER TABLE `people` ADD `job_title` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `default_template_id` text;--> statement-breakpoint
ALTER TABLE `requirements` ADD `priority` text DEFAULT 'P2' NOT NULL;--> statement-breakpoint
ALTER TABLE `template_items` ADD `start_offset_days` integer DEFAULT 0 NOT NULL CHECK (`start_offset_days` >= 0);--> statement-breakpoint
ALTER TABLE `template_items` ADD `duration_days` integer DEFAULT 1 NOT NULL CHECK (`duration_days` >= 1);--> statement-breakpoint
ALTER TABLE `template_items` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `blocked_at` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `blocked_reason` text;--> statement-breakpoint
UPDATE `template_items` SET `start_offset_days` = `sort_order`;--> statement-breakpoint
UPDATE `projects`
SET `default_template_id` = (
  SELECT `id` FROM `work_item_templates`
  WHERE `deleted_at` IS NULL
  ORDER BY CASE WHEN `name` = 'DCIM AI工作流' THEN 0 ELSE 1 END, `created_at`
  LIMIT 1
)
WHERE `default_template_id` IS NULL;--> statement-breakpoint
DROP INDEX `idx_template_items_template_order`;--> statement-breakpoint
CREATE INDEX `idx_template_items_template_order`
ON `template_items` (`template_id`, `deleted_at`, `sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_people_active_name_unique`
ON `people` (lower(trim(`name`)))
WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_work_items_owner_schedule`
ON `work_items` (`owner_id`, `planned_start`, `planned_end`);
