CREATE TABLE `dependency_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_requirement_id` text NOT NULL,
	`source_work_item_id` text,
	`target_requirement_id` text NOT NULL,
	`target_work_item_id` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_dependency_project` ON `dependency_edges` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX idx_dependency_endpoints ON dependency_edges (source_requirement_id, coalesce(source_work_item_id, ''), target_requirement_id, coalesce(target_work_item_id, ''));--> statement-breakpoint
ALTER TABLE `projects` ADD `analysis_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `requirements` ADD `dependencies_reviewed_at` text;--> statement-breakpoint
ALTER TABLE `requirements` ADD `schedule_anchor` text;--> statement-breakpoint
ALTER TABLE `requirements` ADD `forecast_acceptance` text;--> statement-breakpoint
ALTER TABLE `template_items` ADD `predecessor_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_item_templates` ADD `dependency_mode` text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `duration_days` integer;--> statement-breakpoint
ALTER TABLE `work_items` ADD `earliest_start` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `unblock_estimate` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `forecast_duration` integer;--> statement-breakpoint
ALTER TABLE `work_items` ADD `forecast_ready_at` text;
--> statement-breakpoint
CREATE TRIGGER path_work_insert AFTER INSERT ON work_items BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=NEW.requirement_id);
END;
--> statement-breakpoint
CREATE TRIGGER path_work_update AFTER UPDATE ON work_items BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id IN (SELECT project_id FROM requirements WHERE id IN (NEW.requirement_id, OLD.requirement_id));
END;
--> statement-breakpoint
CREATE TRIGGER path_work_delete AFTER DELETE ON work_items BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=OLD.requirement_id);
END;
--> statement-breakpoint
CREATE TRIGGER path_requirement_insert AFTER INSERT ON requirements BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER path_requirement_update AFTER UPDATE ON requirements BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id IN (NEW.project_id, OLD.project_id);
END;
--> statement-breakpoint
CREATE TRIGGER path_requirement_delete AFTER DELETE ON requirements BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER path_dependency_insert AFTER INSERT ON dependency_edges BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER path_dependency_delete AFTER DELETE ON dependency_edges BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER path_dependency_update AFTER UPDATE ON dependency_edges BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id IN (NEW.project_id, OLD.project_id);
END;
--> statement-breakpoint
CREATE TRIGGER path_project_update AFTER UPDATE OF name, planned_start, planned_end, status, deleted_at ON projects BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.id;
END;
