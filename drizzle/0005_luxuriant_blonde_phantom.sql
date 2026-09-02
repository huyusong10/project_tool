CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`normalized_username` text NOT NULL,
	`password_hash` text NOT NULL,
	`person_id` text,
	`global_role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`must_change_password` integer DEFAULT true NOT NULL,
	`session_version` integer DEFAULT 0 NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "accounts_role_valid" CHECK("accounts"."global_role" IN ('user', 'admin')),
	CONSTRAINT "accounts_status_valid" CHECK("accounts"."status" IN ('active', 'disabled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_normalized_username` ON `accounts` (`normalized_username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_accounts_person` ON `accounts` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_accounts_status_role` ON `accounts` (`status`,`global_role`);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `progress_updates` ADD `created_by_account_id` text REFERENCES accounts(id);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_people` (
	`project_id` text NOT NULL,
	`person_id` text NOT NULL,
	`project_role` text DEFAULT 'member' NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `person_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_people_role_valid" CHECK("__new_project_people"."project_role" IN ('member', 'manager'))
);
--> statement-breakpoint
INSERT INTO `__new_project_people`("project_id", "person_id", "project_role", "created_at") SELECT "project_id", "person_id", 'member', "created_at" FROM `project_people`;--> statement-breakpoint
DROP TABLE `project_people`;--> statement-breakpoint
ALTER TABLE `__new_project_people` RENAME TO `project_people`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_project_people_person` ON `project_people` (`person_id`,`project_id`);--> statement-breakpoint
CREATE INDEX `idx_project_people_role` ON `project_people` (`project_id`,`project_role`);
