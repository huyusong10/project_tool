ALTER TABLE `accounts` ADD `deleted_at` text;--> statement-breakpoint
CREATE INDEX `idx_accounts_deleted_at` ON `accounts` (`deleted_at`);
