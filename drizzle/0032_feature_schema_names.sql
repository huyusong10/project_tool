DROP INDEX requirement_groups_name;
--> statement-breakpoint
CREATE UNIQUE INDEX features_name ON features(project_id,name);
--> statement-breakpoint
DROP INDEX requirements_group;
--> statement-breakpoint
CREATE INDEX requirements_feature ON requirements(feature_id);
--> statement-breakpoint
DROP TRIGGER intake_group_insert;
--> statement-breakpoint
CREATE TRIGGER feature_revision_insert AFTER INSERT ON features BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
DROP TRIGGER intake_group_update;
--> statement-breakpoint
CREATE TRIGGER feature_revision_update AFTER UPDATE ON features BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
DROP TRIGGER intake_group_delete;
--> statement-breakpoint
CREATE TRIGGER feature_revision_delete AFTER DELETE ON features BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;
