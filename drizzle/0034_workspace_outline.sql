ALTER TABLE features ADD COLUMN kind TEXT NOT NULL DEFAULT 'feature' CHECK(kind IN ('feature','other'));
--> statement-breakpoint
UPDATE features SET kind='other',archived_at=NULL,version=version+1 WHERE name='其他特性';
--> statement-breakpoint
CREATE UNIQUE INDEX features_system_other ON features(project_id) WHERE kind='other';
--> statement-breakpoint
ALTER TABLE requirements ADD COLUMN sort_order INTEGER NOT NULL DEFAULT -1;
--> statement-breakpoint
CREATE INDEX requirements_outline_order ON requirements(project_id,feature_id,phase_id,sort_order);
--> statement-breakpoint
CREATE TRIGGER requirements_outline_append AFTER INSERT ON requirements WHEN NEW.sort_order=-1 BEGIN
  UPDATE requirements SET sort_order=(SELECT coalesce(max(sort_order),-1)+1 FROM requirements WHERE feature_id IS NEW.feature_id AND phase_id IS NEW.phase_id AND id<>NEW.id) WHERE id=NEW.id;
END;
