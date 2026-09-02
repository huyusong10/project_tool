PRAGMA foreign_keys=OFF;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_project_people` (
	`project_id` text NOT NULL,
	`person_id` text NOT NULL,
	`project_role` text DEFAULT 'member' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `person_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON DELETE cascade,
	CONSTRAINT `project_people_role_valid` CHECK(`project_role` IN ('viewer', 'member', 'manager'))
);--> statement-breakpoint
INSERT INTO `__new_project_people` SELECT `project_id`,`person_id`,`project_role`,`created_at` FROM `project_people`;--> statement-breakpoint
DROP TABLE `project_people`;--> statement-breakpoint
ALTER TABLE `__new_project_people` RENAME TO `project_people`;--> statement-breakpoint
CREATE INDEX `idx_project_people_person` ON `project_people` (`person_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_people_role` ON `project_people` (`project_id`,`project_role`);--> statement-breakpoint

CREATE TEMP TABLE `__template_project_map` (
	`original_template_id` text NOT NULL,
	`project_id` text NOT NULL,
	`new_template_id` text NOT NULL,
	PRIMARY KEY (`original_template_id`,`project_id`)
);--> statement-breakpoint
INSERT INTO `__template_project_map`
SELECT `original_template_id`,`project_id`,lower(hex(randomblob(16))) FROM (
	SELECT t.`id` AS `original_template_id`,p.`id` AS `project_id`
	FROM `work_item_templates` t CROSS JOIN `projects` p WHERE t.`deleted_at` IS NULL
	UNION
	SELECT t.`id`,r.`project_id` FROM `work_item_templates` t
	JOIN `requirements` r ON r.`template_id`=t.`id` WHERE t.`deleted_at` IS NOT NULL
	UNION
	SELECT t.`id`,p.`id` FROM `work_item_templates` t
	JOIN `projects` p ON p.`default_template_id`=t.`id` WHERE t.`deleted_at` IS NOT NULL
);--> statement-breakpoint

-- Keep the remapped ids temporarily valid for the existing foreign keys. SQLite
-- cannot reliably switch foreign_keys off from inside the migration transaction.
INSERT INTO `work_item_templates` (`id`,`name`,`description`,`created_at`,`updated_at`,`deleted_at`)
SELECT m.`new_template_id`,t.`name`,t.`description`,t.`created_at`,t.`updated_at`,t.`deleted_at`
FROM `__template_project_map` m JOIN `work_item_templates` t ON t.`id`=m.`original_template_id`;--> statement-breakpoint

CREATE TABLE `__new_work_item_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_work_item_templates`
SELECT m.`new_template_id`,m.`project_id`,t.`name`,t.`description`,t.`created_at`,t.`updated_at`,t.`deleted_at`
FROM `__template_project_map` m JOIN `work_item_templates` t ON t.`id`=m.`original_template_id`;--> statement-breakpoint

CREATE TEMP TABLE `__template_item_map` (
	`original_item_id` text NOT NULL,
	`project_id` text NOT NULL,
	`new_item_id` text NOT NULL,
	PRIMARY KEY (`original_item_id`,`project_id`)
);--> statement-breakpoint
INSERT INTO `__template_item_map`
SELECT i.`id`,m.`project_id`,lower(hex(randomblob(16)))
FROM `template_items` i JOIN `__template_project_map` m ON m.`original_template_id`=i.`template_id`;--> statement-breakpoint

INSERT INTO `template_items` (`id`,`template_id`,`title`,`sort_order`,`start_offset_days`,`duration_days`,`deleted_at`)
SELECT im.`new_item_id`,i.`template_id`,i.`title`,i.`sort_order`,i.`start_offset_days`,i.`duration_days`,i.`deleted_at`
FROM `__template_item_map` im JOIN `template_items` i ON i.`id`=im.`original_item_id`;--> statement-breakpoint

CREATE TABLE `__new_template_items` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`start_offset_days` integer DEFAULT 0 NOT NULL,
	`duration_days` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`template_id`) REFERENCES `__new_work_item_templates`(`id`) ON DELETE cascade,
	CONSTRAINT `template_items_offset_nonnegative` CHECK(`start_offset_days` >= 0),
	CONSTRAINT `template_items_duration_positive` CHECK(`duration_days` >= 1)
);--> statement-breakpoint
INSERT INTO `__new_template_items`
SELECT im.`new_item_id`,m.`new_template_id`,i.`title`,i.`sort_order`,i.`start_offset_days`,i.`duration_days`,i.`deleted_at`
FROM `template_items` i
JOIN `__template_item_map` im ON im.`original_item_id`=i.`id`
JOIN `__template_project_map` m ON m.`original_template_id`=i.`template_id` AND m.`project_id`=im.`project_id`;--> statement-breakpoint

UPDATE `projects` SET `default_template_id`=(
	SELECT m.`new_template_id` FROM `__template_project_map` m
	WHERE m.`original_template_id`=`projects`.`default_template_id` AND m.`project_id`=`projects`.`id`
) WHERE `default_template_id` IS NOT NULL;--> statement-breakpoint
UPDATE `requirements` SET `template_id`=(
	SELECT m.`new_template_id` FROM `__template_project_map` m
	WHERE m.`original_template_id`=`requirements`.`template_id` AND m.`project_id`=`requirements`.`project_id`
) WHERE `template_id` IS NOT NULL;--> statement-breakpoint
UPDATE `work_items` SET `template_item_id`=(
	SELECT im.`new_item_id` FROM `__template_item_map` im
	JOIN `requirements` r ON r.`id`=`work_items`.`requirement_id`
	WHERE im.`original_item_id`=`work_items`.`template_item_id` AND im.`project_id`=r.`project_id`
) WHERE `template_item_id` IS NOT NULL;--> statement-breakpoint

DROP TABLE `template_items`;--> statement-breakpoint
DROP TABLE `work_item_templates`;--> statement-breakpoint
ALTER TABLE `__new_work_item_templates` RENAME TO `work_item_templates`;--> statement-breakpoint
ALTER TABLE `__new_template_items` RENAME TO `template_items`;--> statement-breakpoint
CREATE INDEX `idx_templates_project_deleted` ON `work_item_templates` (`project_id`,`deleted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_templates_project_active_name_unique` ON `work_item_templates` (`project_id`,lower(trim(`name`))) WHERE `deleted_at` IS NULL;--> statement-breakpoint
CREATE INDEX `idx_template_items_template_order` ON `template_items` (`template_id`,`deleted_at`,`sort_order`);--> statement-breakpoint
DROP TABLE `__template_item_map`;--> statement-breakpoint
DROP TABLE `__template_project_map`;--> statement-breakpoint

UPDATE `api_tokens` SET `account_id`=(SELECT `id` FROM `accounts` WHERE `is_builtin`=1 LIMIT 1) WHERE `account_id` IS NULL;--> statement-breakpoint
DELETE FROM `api_tokens` WHERE `account_id` IS NULL;--> statement-breakpoint
CREATE TABLE `__new_api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`token_hash` text NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_api_tokens` SELECT `id`,`name`,`prefix`,`token_hash`,`account_id`,`expires_at`,`last_used_at`,`revoked_at`,`created_at` FROM `api_tokens`;--> statement-breakpoint
DROP TABLE `api_tokens`;--> statement-breakpoint
ALTER TABLE `__new_api_tokens` RENAME TO `api_tokens`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_api_tokens_prefix` ON `api_tokens` (`prefix`);--> statement-breakpoint

CREATE TABLE `__new_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`project_id` text,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_audit_logs` (`id`,`actor_type`,`actor_id`,`action`,`entity_type`,`entity_id`,`project_id`,`summary`,`created_at`)
SELECT `id`,`actor_type`,`actor_id`,`action`,`entity_type`,`entity_id`,NULL,`summary`,`created_at` FROM `audit_logs`;--> statement-breakpoint
DROP TABLE `audit_logs`;--> statement-breakpoint
ALTER TABLE `__new_audit_logs` RENAME TO `audit_logs`;--> statement-breakpoint
CREATE INDEX `idx_audit_created_at` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_project_created` ON `audit_logs` (`project_id`,`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
