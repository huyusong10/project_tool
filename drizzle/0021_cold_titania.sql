CREATE TABLE `dependency_change_receipts` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`committed_revision` integer NOT NULL,
	`added_ids` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_dependency_receipt_project` ON `dependency_change_receipts` (`project_id`);