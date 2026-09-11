ALTER TABLE requirement_groups ADD COLUMN description TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE requirement_groups ADD COLUMN archived_at TEXT;
--> statement-breakpoint
CREATE TABLE feature_relations (
 id TEXT PRIMARY KEY NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 source_feature_id TEXT NOT NULL REFERENCES requirement_groups(id) ON DELETE CASCADE,
 target_feature_id TEXT NOT NULL REFERENCES requirement_groups(id) ON DELETE CASCADE,
 note TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id,source_feature_id,target_feature_id), CHECK(source_feature_id<>target_feature_id)
);
--> statement-breakpoint
CREATE TRIGGER feature_relations_insert AFTER INSERT ON feature_relations BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER feature_relations_update AFTER UPDATE ON feature_relations BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER feature_relations_delete AFTER DELETE ON feature_relations BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;
--> statement-breakpoint
CREATE TRIGGER feature_assignment_insert BEFORE INSERT ON requirements
 WHEN NEW.group_id IS NOT NULL AND EXISTS(SELECT 1 FROM requirement_groups WHERE id=NEW.group_id AND archived_at IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'FEATURE_ARCHIVED'); END;
--> statement-breakpoint
CREATE TRIGGER feature_assignment_update BEFORE UPDATE OF group_id,status ON requirements
 WHEN NEW.group_id IS NOT NULL AND EXISTS(SELECT 1 FROM requirement_groups WHERE id=NEW.group_id AND archived_at IS NOT NULL)
 AND (NEW.group_id IS NOT OLD.group_id OR (NEW.status NOT IN ('completed','cancelled') AND NEW.status IS NOT OLD.status))
 BEGIN SELECT RAISE(ABORT,'FEATURE_ARCHIVED'); END;
