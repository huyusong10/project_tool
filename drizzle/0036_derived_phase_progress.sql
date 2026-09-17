-- Historical deliveries remain available; current progress comes from requirements.
DROP TRIGGER IF EXISTS phase_requirement_guard_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS phase_requirement_guard_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS phase_requirement_guard_delete;
--> statement-breakpoint
DROP TRIGGER IF EXISTS delivered_work_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS delivered_work_update;
--> statement-breakpoint
DROP TRIGGER IF EXISTS delivered_work_delete;
--> statement-breakpoint
CREATE TRIGGER phase_requirement_guard_insert BEFORE INSERT ON requirements WHEN NEW.phase_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM feature_phases p WHERE p.id=NEW.phase_id AND p.feature_id=NEW.feature_id AND p.project_id=NEW.project_id) THEN RAISE(ABORT,'Phase 不属于该特性') END;
END;
--> statement-breakpoint
CREATE TRIGGER phase_requirement_guard_update BEFORE UPDATE ON requirements WHEN NEW.phase_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM feature_phases p WHERE p.id=NEW.phase_id AND p.feature_id=NEW.feature_id AND p.project_id=NEW.project_id) THEN RAISE(ABORT,'Phase 不属于该特性') END;
END;
