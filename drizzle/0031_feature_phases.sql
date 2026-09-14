ALTER TABLE requirement_groups RENAME TO features;
--> statement-breakpoint
ALTER TABLE requirements RENAME COLUMN group_id TO feature_id;
--> statement-breakpoint
ALTER TABLE features ADD COLUMN reference_links TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
CREATE TABLE feature_phases (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), feature_id TEXT NOT NULL REFERENCES features(id),
 name TEXT NOT NULL, scope TEXT NOT NULL DEFAULT '', target_date TEXT, note TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
 started_at TEXT, delivered_at TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(feature_id,name)
);
--> statement-breakpoint
CREATE TABLE phase_deliveries (
 id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES feature_phases(id), delivered_at TEXT NOT NULL,
 delivered_by TEXT REFERENCES accounts(id), snapshot TEXT NOT NULL, created_at TEXT NOT NULL,
 reopened_at TEXT, reopen_reason TEXT
);
--> statement-breakpoint
ALTER TABLE requirements ADD COLUMN phase_id TEXT REFERENCES feature_phases(id);
--> statement-breakpoint
ALTER TABLE requirements ADD COLUMN stage_reset_at TEXT;
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN work_stage TEXT CHECK(work_stage IS NULL OR work_stage IN ('analysis','development','integration','testing','other'));
--> statement-breakpoint
ALTER TABLE template_items ADD COLUMN work_stage TEXT CHECK(work_stage IS NULL OR work_stage IN ('analysis','development','integration','testing','other'));
--> statement-breakpoint
ALTER TABLE template_items ADD COLUMN milestone_kind TEXT NOT NULL DEFAULT 'ordinary';
--> statement-breakpoint
ALTER TABLE milestones ADD COLUMN milestone_kind TEXT NOT NULL DEFAULT 'ordinary';
--> statement-breakpoint
ALTER TABLE milestones ADD COLUMN achieved_recorded_at TEXT;
--> statement-breakpoint
CREATE INDEX idx_requirements_phase ON requirements(phase_id);
--> statement-breakpoint
CREATE INDEX idx_phases_feature ON feature_phases(feature_id,sort_order);
--> statement-breakpoint
CREATE INDEX idx_phase_deliveries_phase ON phase_deliveries(phase_id,created_at);
--> statement-breakpoint
UPDATE work_items SET work_stage=CASE
 WHEN title IN ('需求设计','UX设计','需求基线','UX设计基线','前端设计基线','后端设计基线','数据设计基线','接口设计基线','验证设计基线','MPS编写','MDS编写','SDS文档编写','组织管理MPS设计','组织管理工作分解') THEN 'analysis'
 WHEN title IN ('前端开发','后端开发','数据开发','组件库开发','组件库适配','软件适配到SDS架构') THEN 'development'
 WHEN title='联调' THEN 'integration' WHEN title IN ('测试','测试验收') THEN 'testing' ELSE NULL END;
--> statement-breakpoint
UPDATE template_items SET work_stage=CASE
 WHEN kind='milestone' THEN NULL
 WHEN title IN ('需求设计','UX设计','需求基线','UX设计基线','前端设计基线','后端设计基线','数据设计基线','接口设计基线','验证设计基线','MPS编写','MDS编写','SDS文档编写') THEN 'analysis'
 WHEN title IN ('前端开发','后端开发','数据开发','组件库开发','组件库适配') THEN 'development'
 WHEN title='联调' THEN 'integration' WHEN title IN ('测试','测试验收') THEN 'testing' ELSE NULL END;
--> statement-breakpoint
UPDATE milestones SET milestone_kind=CASE title WHEN '需求基线' THEN 'analysis_completed' WHEN '设计基线' THEN 'design_completed' WHEN '提测就绪' THEN 'test_ready' WHEN '测试通过' THEN 'test_passed' ELSE 'ordinary' END, achieved_recorded_at=CASE WHEN achieved_at IS NOT NULL THEN updated_at ELSE NULL END;
--> statement-breakpoint
UPDATE template_items SET milestone_kind=CASE WHEN kind='milestone' THEN CASE title WHEN '需求基线' THEN 'analysis_completed' WHEN '设计基线' THEN 'design_completed' WHEN '提测就绪' THEN 'test_ready' WHEN '测试通过' THEN 'test_passed' ELSE 'ordinary' END ELSE 'ordinary' END;
--> statement-breakpoint
CREATE TRIGGER phase_revision_insert AFTER INSERT ON feature_phases BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER phase_revision_update AFTER UPDATE ON feature_phases BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER phase_revision_delete AFTER DELETE ON feature_phases BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;
--> statement-breakpoint
CREATE TRIGGER phase_requirement_guard_insert BEFORE INSERT ON requirements WHEN NEW.phase_id IS NOT NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM feature_phases p WHERE p.id=NEW.phase_id AND p.feature_id=NEW.feature_id AND p.project_id=NEW.project_id AND p.delivered_at IS NULL) THEN RAISE(ABORT,'Phase 归属无效或已交付') END;
END;
--> statement-breakpoint
CREATE TRIGGER phase_requirement_guard_update BEFORE UPDATE ON requirements BEGIN
 SELECT CASE WHEN NEW.phase_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM feature_phases p WHERE p.id=NEW.phase_id AND p.feature_id=NEW.feature_id AND p.project_id=NEW.project_id) THEN RAISE(ABORT,'Phase 不属于该特性') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM feature_phases p WHERE p.id=OLD.phase_id AND p.delivered_at IS NOT NULL) AND (NEW.phase_id IS NOT OLD.phase_id OR NEW.feature_id IS NOT OLD.feature_id OR NEW.status IS NOT OLD.status OR NEW.title IS NOT OLD.title OR NEW.acceptance_criteria IS NOT OLD.acceptance_criteria) THEN RAISE(ABORT,'请先重新打开已交付 Phase') END;
 SELECT CASE WHEN NEW.phase_id IS NOT OLD.phase_id AND EXISTS(SELECT 1 FROM feature_phases p WHERE p.id=NEW.phase_id AND p.delivered_at IS NOT NULL) THEN RAISE(ABORT,'已交付 Phase 不能接收需求') END;
END;
--> statement-breakpoint
CREATE TRIGGER phase_requirement_guard_delete BEFORE DELETE ON requirements WHEN EXISTS(SELECT 1 FROM feature_phases p WHERE p.id=OLD.phase_id AND p.delivered_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'请先重新打开已交付 Phase'); END;

--> statement-breakpoint
CREATE TRIGGER delivered_work_insert BEFORE INSERT ON work_items WHEN EXISTS(SELECT 1 FROM requirements r JOIN feature_phases p ON p.id=r.phase_id WHERE r.id=NEW.requirement_id AND p.delivered_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'请先重新打开已交付 Phase'); END;
--> statement-breakpoint
CREATE TRIGGER delivered_work_delete BEFORE DELETE ON work_items WHEN EXISTS(SELECT 1 FROM requirements r JOIN feature_phases p ON p.id=r.phase_id WHERE r.id=OLD.requirement_id AND p.delivered_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'请先重新打开已交付 Phase'); END;
--> statement-breakpoint
CREATE TRIGGER delivered_work_update BEFORE UPDATE ON work_items WHEN (NEW.status IS NOT OLD.status OR NEW.progress IS NOT OLD.progress OR NEW.title IS NOT OLD.title OR NEW.actual_start IS NOT OLD.actual_start OR NEW.actual_end IS NOT OLD.actual_end OR NEW.work_stage IS NOT OLD.work_stage) AND EXISTS(SELECT 1 FROM requirements r JOIN feature_phases p ON p.id=r.phase_id WHERE r.id=OLD.requirement_id AND p.delivered_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'请先重新打开已交付 Phase'); END;
--> statement-breakpoint
CREATE TRIGGER work_stage_reopen AFTER UPDATE OF status ON work_items WHEN OLD.status IN ('completed','cancelled') AND NEW.status IN ('in_progress','not_started') BEGIN UPDATE requirements SET stage_reset_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.requirement_id; END;
--> statement-breakpoint
CREATE TRIGGER requirement_stage_reopen AFTER UPDATE OF status ON requirements WHEN OLD.status IN ('completed','cancelled') AND NEW.status IN ('in_progress','not_started') BEGIN UPDATE requirements SET stage_reset_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=NEW.id; END;

--> statement-breakpoint
CREATE TRIGGER phase_mark_started_insert AFTER INSERT ON requirements WHEN NEW.phase_id IS NOT NULL AND NEW.status IN ('in_progress','completed') BEGIN UPDATE feature_phases SET started_at=COALESCE(started_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=NEW.phase_id; END;
--> statement-breakpoint
CREATE TRIGGER phase_mark_started_update AFTER UPDATE ON requirements WHEN NEW.phase_id IS NOT NULL AND NEW.status IN ('in_progress','completed') BEGIN UPDATE feature_phases SET started_at=COALESCE(started_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id=NEW.phase_id AND started_at IS NULL; END;
