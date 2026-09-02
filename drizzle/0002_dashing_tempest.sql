CREATE TABLE `work_item_collaborators` (
	`work_item_id` text NOT NULL,
	`person_id` text NOT NULL,
	PRIMARY KEY(`work_item_id`, `person_id`),
	FOREIGN KEY (`work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_work_item_collaborators_person` ON `work_item_collaborators` (`person_id`,`work_item_id`);