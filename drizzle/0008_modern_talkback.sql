CREATE TABLE `analytics_layouts` (
	`account_id` text PRIMARY KEY NOT NULL,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
