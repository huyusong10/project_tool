ALTER TABLE `project_people` ADD `updated_at` text;
--> statement-breakpoint
UPDATE `project_people` SET `updated_at`=`created_at` WHERE `updated_at` IS NULL;
