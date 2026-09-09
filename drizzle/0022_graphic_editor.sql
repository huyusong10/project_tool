CREATE TABLE `diagram_layouts` (
	`project_id` text NOT NULL,
	`scope` text NOT NULL,
	`direction` text NOT NULL,
	`positions` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `scope`, `direction`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`requirement_id` text,
	`template_item_id` text,
	`title` text NOT NULL,
	`target_date` text,
	`confirmation_mode` text DEFAULT 'auto' NOT NULL,
	`achieved_at` text,
	`achieved_by` text,
	`cancelled` integer DEFAULT false NOT NULL,
	`legacy_work_item_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_item_id`) REFERENCES `template_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`achieved_by`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`legacy_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `milestones_legacy_work_item_id_unique` ON `milestones` (`legacy_work_item_id`);--> statement-breakpoint
CREATE INDEX `idx_milestones_project` ON `milestones` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_milestones_requirement` ON `milestones` (`requirement_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_template_items` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`title` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`start_offset_days` integer DEFAULT 0 NOT NULL,
	`duration_days` integer DEFAULT 1 NOT NULL,
	`milestone_label` text,
	`kind` text DEFAULT 'work' NOT NULL,
	`arrangement` text DEFAULT 'early' NOT NULL,
	`arrangement_anchor` text,
	`confirmation_mode` text DEFAULT 'auto' NOT NULL,
	`predecessor_ids` text DEFAULT '[]' NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`template_id`) REFERENCES `work_item_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "template_items_offset_nonnegative" CHECK("__new_template_items"."start_offset_days" >= 0),
	CONSTRAINT "template_items_duration_positive" CHECK(("__new_template_items"."kind"='work' AND "__new_template_items"."duration_days">=1) OR ("__new_template_items"."kind"='milestone' AND "__new_template_items"."duration_days"=0))
);
--> statement-breakpoint
INSERT INTO `__new_template_items`("id", "template_id", "title", "sort_order", "start_offset_days", "duration_days", "milestone_label", "kind", "arrangement", "arrangement_anchor", "confirmation_mode", "predecessor_ids", "deleted_at") SELECT "id", "template_id", "title", "sort_order", "start_offset_days", "duration_days", "milestone_label", 'work', 'early', NULL, 'auto', "predecessor_ids", "deleted_at" FROM `template_items`;--> statement-breakpoint
DROP TABLE `template_items`;--> statement-breakpoint
ALTER TABLE `__new_template_items` RENAME TO `template_items`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `idx_template_items_template_order` ON `template_items` (`template_id`,`deleted_at`,`sort_order`);--> statement-breakpoint
CREATE TABLE `__new_dependency_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source_requirement_id` text,
	`source_work_item_id` text,
	`target_requirement_id` text,
	`target_work_item_id` text,
	`source_milestone_id` text,
	`target_milestone_id` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_work_item_id`) REFERENCES `work_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_milestone_id`) REFERENCES `milestones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_dependency_edges`("id", "project_id", "source_requirement_id", "source_work_item_id", "target_requirement_id", "target_work_item_id", "source_milestone_id", "target_milestone_id", "origin", "created_at", "updated_at") SELECT "id", "project_id", "source_requirement_id", "source_work_item_id", "target_requirement_id", "target_work_item_id", NULL, NULL, "origin", "created_at", "updated_at" FROM `dependency_edges`;--> statement-breakpoint
DROP TABLE `dependency_edges`;--> statement-breakpoint
ALTER TABLE `__new_dependency_edges` RENAME TO `dependency_edges`;--> statement-breakpoint
CREATE INDEX `idx_dependency_project` ON `dependency_edges` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_dependency_target` ON `dependency_edges` (`target_requirement_id`);--> statement-breakpoint
CREATE INDEX `idx_dependency_source` ON `dependency_edges` (`source_requirement_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_dependency_endpoints` ON `dependency_edges` (coalesce(source_requirement_id,''),coalesce(source_work_item_id,''),coalesce(source_milestone_id,''),coalesce(target_requirement_id,''),coalesce(target_work_item_id,''),coalesce(target_milestone_id,''));--> statement-breakpoint
ALTER TABLE `requirements` ADD `acknowledged_dependencies` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `arrangement` text DEFAULT 'early' NOT NULL;--> statement-breakpoint
ALTER TABLE `work_items` ADD `arrangement_anchor` text;--> statement-breakpoint
ALTER TABLE `work_items` ADD `acknowledged_dependencies` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER editor_dependency_edges_insert AFTER INSERT ON dependency_edges BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;

--> statement-breakpoint
CREATE TRIGGER editor_dependency_edges_update AFTER UPDATE ON dependency_edges BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;

--> statement-breakpoint
CREATE TRIGGER editor_dependency_edges_delete AFTER DELETE ON dependency_edges BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;

--> statement-breakpoint
CREATE TRIGGER editor_milestones_insert AFTER INSERT ON milestones BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;

--> statement-breakpoint
CREATE TRIGGER editor_milestones_update AFTER UPDATE ON milestones BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;

--> statement-breakpoint
CREATE TRIGGER editor_milestones_delete AFTER DELETE ON milestones BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;

--> statement-breakpoint
INSERT OR IGNORE INTO milestones(id,project_id,requirement_id,title,target_date,confirmation_mode,achieved_at,legacy_work_item_id,created_at,updated_at)
 SELECT 'milestone:'||w.id,r.project_id,w.requirement_id,w.milestone_label,w.planned_end,'auto',CASE WHEN w.status='completed' THEN w.actual_end END,w.id,w.created_at,w.updated_at FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE trim(coalesce(w.milestone_label,''))<>'';
--> statement-breakpoint
INSERT OR IGNORE INTO dependency_edges(id,project_id,source_requirement_id,source_work_item_id,target_requirement_id,target_milestone_id,origin,created_at,updated_at)
 SELECT 'milestone-edge:'||m.id,m.project_id,m.requirement_id,m.legacy_work_item_id,m.requirement_id,m.id,'legacy-milestone',m.created_at,m.updated_at FROM milestones m WHERE m.legacy_work_item_id IS NOT NULL;
--> statement-breakpoint
INSERT OR IGNORE INTO template_items(id,template_id,title,sort_order,start_offset_days,duration_days,kind,predecessor_ids,deleted_at)
 SELECT 'milestone:'||i.id,i.template_id,i.milestone_label,i.sort_order+10000,i.start_offset_days+i.duration_days,0,'milestone',json_array(i.id),i.deleted_at FROM template_items i WHERE trim(coalesce(i.milestone_label,''))<>'' AND i.kind='work';

--> statement-breakpoint
UPDATE milestones SET template_item_id='milestone:'||(SELECT template_item_id FROM work_items WHERE id=milestones.legacy_work_item_id) WHERE legacy_work_item_id IS NOT NULL AND EXISTS(SELECT 1 FROM template_items WHERE id='milestone:'||(SELECT template_item_id FROM work_items WHERE id=milestones.legacy_work_item_id));
