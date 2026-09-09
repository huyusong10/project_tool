CREATE INDEX `idx_dependency_target` ON `dependency_edges` (`target_requirement_id`);--> statement-breakpoint
CREATE INDEX `idx_dependency_source` ON `dependency_edges` (`source_requirement_id`);
--> statement-breakpoint
CREATE TRIGGER paths_new_work_review AFTER INSERT ON work_items
WHEN (SELECT dependencies_reviewed_at FROM requirements WHERE id=NEW.requirement_id) IS NOT NULL
BEGIN
  UPDATE requirements SET dependencies_reviewed_at=NULL WHERE id=NEW.requirement_id;
END;
