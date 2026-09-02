CREATE TABLE `project_people` (
	`project_id` text NOT NULL,
	`person_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `person_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_people_person` ON `project_people` (`person_id`,`project_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `project_people` (`project_id`, `person_id`, `created_at`)
SELECT DISTINCT r.`project_id`, w.`owner_id`, COALESCE(w.`updated_at`, r.`updated_at`)
FROM `work_items` w
JOIN `requirements` r ON r.`id` = w.`requirement_id`
JOIN `people` p ON p.`id` = w.`owner_id`
WHERE w.`owner_id` IS NOT NULL AND p.`deleted_at` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `project_people` (`project_id`, `person_id`, `created_at`)
SELECT DISTINCT r.`project_id`, c.`person_id`, COALESCE(w.`updated_at`, r.`updated_at`)
FROM `work_item_collaborators` c
JOIN `work_items` w ON w.`id` = c.`work_item_id`
JOIN `requirements` r ON r.`id` = w.`requirement_id`
JOIN `people` p ON p.`id` = c.`person_id`
WHERE p.`deleted_at` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `project_people` (`project_id`, `person_id`, `created_at`)
SELECT DISTINCT r.`project_id`, r.`owner_id`, r.`updated_at`
FROM `requirements` r
JOIN `people` p ON p.`id` = r.`owner_id`
WHERE r.`owner_id` IS NOT NULL AND p.`deleted_at` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `project_people` (`project_id`, `person_id`, `created_at`)
SELECT pr.`id`, p.`id`, p.`updated_at`
FROM `projects` pr CROSS JOIN `people` p
WHERE pr.`deleted_at` IS NULL AND p.`deleted_at` IS NULL
  AND (SELECT COUNT(*) FROM `projects` WHERE `deleted_at` IS NULL) = 1;
