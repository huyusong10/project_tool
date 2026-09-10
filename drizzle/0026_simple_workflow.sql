DROP TRIGGER IF EXISTS "blocker_issue_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "delivery_commitment_revision";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "delivery_requirement_fields";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editor_dependency_edges_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editor_dependency_edges_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editor_dependency_edges_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editor_milestones_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editor_milestones_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "editor_milestones_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_clause_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_clause_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_document_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_document_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_group_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_group_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_group_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_link_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_link_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "intake_link_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "path_project_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "path_requirement_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "path_requirement_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "path_requirement_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "path_work_delete";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "path_work_insert";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "path_work_update";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "paths_new_work_review";
--> statement-breakpoint
-- Merge execution states and preserve retired workflow facts. The application backs up before applying migrations.

INSERT INTO audit_logs(id,actor_type,action,entity_type,entity_id,project_id,summary,created_at) SELECT lower(hex(randomblob(16))),'system','workflow_migration','requirement',id,project_id,'工作流简化前记录：'||json_object('status',status,'blockedAt',blocked_at,'blockedReason',blocked_reason,'coordinator',blocked_coordinator_id,'reviewAt',blocked_next_review_at,'issueId',blocked_issue_id),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM requirements WHERE status IN ('planning','blocked','pending_acceptance') OR blocked_reason IS NOT NULL;

--> statement-breakpoint

INSERT INTO audit_logs(id,actor_type,action,entity_type,entity_id,project_id,summary,created_at) SELECT lower(hex(randomblob(16))),'system','workflow_migration','work_item',id,(SELECT project_id FROM requirements WHERE id=work_items.requirement_id),'工作流简化前记录：'||json_object('status',status,'blockedAt',blocked_at,'blockedReason',blocked_reason,'coordinator',blocked_coordinator_id,'reviewAt',blocked_next_review_at,'issueId',blocked_issue_id),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM work_items WHERE status IN ('planning','blocked','pending_acceptance') OR blocked_reason IS NOT NULL;

--> statement-breakpoint

CREATE TABLE "__workflow_work_items" (
	`id` text PRIMARY KEY NOT NULL,
	`requirement_id` text NOT NULL,
	`template_item_id` text,
	`title` text NOT NULL,
	`owner_id` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`planned_start` text,
	`planned_end` text,
	`actual_start` text,
	`actual_end` text,
	`forecast_end` text,
	`blocked_at` text,
	`blocked_reason` text,
	`milestone_label` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL, `duration_days` integer, `earliest_start` text, `unblock_estimate` text, `forecast_duration` integer, `forecast_ready_at` text, `arrangement` text DEFAULT 'early' NOT NULL, `arrangement_anchor` text, `acknowledged_dependencies` text DEFAULT '[]' NOT NULL, forecast_review TEXT, blocked_coordinator_id TEXT REFERENCES people(id), blocked_next_review_at TEXT, blocked_issue_id TEXT REFERENCES issues(id),
	FOREIGN KEY (`requirement_id`) REFERENCES `requirements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_item_id`) REFERENCES `template_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "work_items_progress_range" CHECK("__workflow_work_items"."progress" >= 0 AND "__workflow_work_items"."progress" <= 100),
	CONSTRAINT "work_items_status_valid" CHECK("__workflow_work_items"."status" IN ('not_started', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "work_items_state_consistent" CHECK((
    ("__workflow_work_items"."status" = 'not_started' AND "__workflow_work_items"."progress" = 0 AND "__workflow_work_items"."actual_start" IS NULL AND "__workflow_work_items"."actual_end" IS NULL AND "__workflow_work_items"."blocked_at" IS NULL) OR
    ("__workflow_work_items"."status" = 'in_progress' AND "__workflow_work_items"."progress" < 100 AND "__workflow_work_items"."actual_start" IS NOT NULL AND "__workflow_work_items"."actual_end" IS NULL AND "__workflow_work_items"."blocked_at" IS NULL) OR
    ("__workflow_work_items"."status" = 'completed' AND "__workflow_work_items"."progress" = 100 AND "__workflow_work_items"."actual_start" IS NOT NULL AND "__workflow_work_items"."actual_end" IS NOT NULL AND "__workflow_work_items"."blocked_at" IS NULL) OR
    ("__workflow_work_items"."status" = 'cancelled' AND "__workflow_work_items"."progress" < 100 AND "__workflow_work_items"."actual_end" IS NULL AND "__workflow_work_items"."blocked_at" IS NULL)
  ))
);

--> statement-breakpoint

INSERT INTO "__workflow_work_items" ("id","requirement_id","template_item_id","title","owner_id","status","planned_start","planned_end","actual_start","actual_end","forecast_end","blocked_at","blocked_reason","milestone_label","progress","sort_order","version","created_at","updated_at","duration_days","earliest_start","unblock_estimate","forecast_duration","forecast_ready_at","arrangement","arrangement_anchor","acknowledged_dependencies","forecast_review","blocked_coordinator_id","blocked_next_review_at","blocked_issue_id") SELECT "id","requirement_id","template_item_id","title","owner_id",CASE WHEN status='blocked' THEN 'in_progress' ELSE status END,"planned_start","planned_end","actual_start","actual_end","forecast_end",NULL,NULL,"milestone_label","progress","sort_order","version","created_at","updated_at","duration_days","earliest_start",NULL,"forecast_duration","forecast_ready_at","arrangement","arrangement_anchor","acknowledged_dependencies",NULL,NULL,NULL,NULL FROM "work_items";

--> statement-breakpoint

DROP TABLE "work_items";

--> statement-breakpoint

ALTER TABLE "__workflow_work_items" RENAME TO "work_items";

--> statement-breakpoint

CREATE INDEX `idx_work_items_requirement_order` ON `work_items` (`requirement_id`,`sort_order`);

--> statement-breakpoint

CREATE INDEX `idx_work_items_status` ON `work_items` (`status`);

--> statement-breakpoint

CREATE INDEX `idx_work_items_owner_schedule` ON `work_items` (`owner_id`,`planned_start`,`planned_end`);

--> statement-breakpoint

CREATE TABLE "__workflow_requirements" (
"source_notes" TEXT,
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`template_id` text,
	`title` text NOT NULL,
	`owner_id` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`planned_start` text,
	`planned_end` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`risk_level` text DEFAULT 'low' NOT NULL,
	`priority` text DEFAULT 'P2' NOT NULL,
	`accepted_at` text,
	`accepted_by_account_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text, `background` text, `acceptance_criteria` text, `reference_url` text, `dependencies_reviewed_at` text, `schedule_anchor` text, `forecast_acceptance` text, `acknowledged_dependencies` text DEFAULT '[]' NOT NULL, delivery_scope text NOT NULL DEFAULT 'committed' CHECK(delivery_scope IN ('committed','candidate')), execution_mode text NOT NULL DEFAULT 'work_items' CHECK(execution_mode IN ('direct','work_items')), acceptance_owner_id text REFERENCES people(id), actual_start text, actual_end text, blocked_at text, blocked_reason text, duration_days integer CHECK(duration_days IS NULL OR duration_days>0), forecast_end text, unblock_estimate text, split_base_progress integer NOT NULL DEFAULT 0 CHECK(split_base_progress BETWEEN 0 AND 99), split_at text, forecast_duration integer, forecast_ready_at text, forecast_review TEXT, blocked_coordinator_id TEXT REFERENCES people(id), blocked_next_review_at TEXT, blocked_issue_id TEXT REFERENCES issues(id), group_id TEXT REFERENCES requirement_groups(id) ON DELETE SET NULL, tags TEXT NOT NULL DEFAULT '[]',
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `work_item_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`accepted_by_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "requirements_progress_range" CHECK("__workflow_requirements"."progress" >= 0 AND "__workflow_requirements"."progress" <= 100),
	CONSTRAINT "requirements_status_valid" CHECK("__workflow_requirements"."status" IN ('not_started', 'in_progress', 'completed', 'cancelled')),
	CONSTRAINT "requirements_terminal_consistent" CHECK((status='completed' AND progress=100) OR (status<>'completed' AND progress<100))
);

--> statement-breakpoint

INSERT INTO "__workflow_requirements" ("id","project_id","template_id","title","owner_id","status","planned_start","planned_end","progress","risk_level","priority","accepted_at","accepted_by_account_id","version","created_at","updated_at","deleted_at","background","acceptance_criteria","reference_url","dependencies_reviewed_at","schedule_anchor","forecast_acceptance","acknowledged_dependencies","delivery_scope","execution_mode","acceptance_owner_id","actual_start","actual_end","blocked_at","blocked_reason","duration_days","forecast_end","unblock_estimate","split_base_progress","split_at","forecast_duration","forecast_ready_at","forecast_review","blocked_coordinator_id","blocked_next_review_at","blocked_issue_id","group_id","tags","source_notes") SELECT "id","project_id","template_id","title","owner_id",CASE WHEN status='cancelled' THEN 'cancelled' WHEN status IN ('completed','pending_acceptance') OR (execution_mode='work_items' AND EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id AND w.status<>'cancelled') AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id AND w.status NOT IN ('completed','cancelled'))) THEN 'completed' WHEN status='planning' THEN 'not_started' WHEN status='blocked' THEN CASE WHEN actual_start IS NULL AND progress=0 THEN 'not_started' ELSE 'in_progress' END ELSE status END,"planned_start","planned_end",CASE WHEN status='cancelled' THEN min(progress,99) WHEN status IN ('completed','pending_acceptance') OR (execution_mode='work_items' AND EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id AND w.status<>'cancelled') AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id AND w.status NOT IN ('completed','cancelled'))) THEN 100 ELSE min(progress,99) END,"risk_level","priority","accepted_at","accepted_by_account_id","version","created_at","updated_at","deleted_at","background","acceptance_criteria","reference_url","dependencies_reviewed_at","schedule_anchor","forecast_acceptance","acknowledged_dependencies",'committed',CASE WHEN EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id) THEN 'work_items' ELSE 'direct' END,"acceptance_owner_id","actual_start","actual_end",NULL,NULL,"duration_days","forecast_end",NULL,"split_base_progress","split_at","forecast_duration","forecast_ready_at",NULL,NULL,NULL,NULL,"group_id","tags",(SELECT group_concat('原始需求：'||v.external_id||' '||v.title||char(10)||'出处：'||d.title||' '||d.url||char(10)||'版本：'||v.document_version||' '||v.section||char(10)||v.content||char(10)||'已有实现说明：'||l.scope||CASE WHEN l.work_item_id IS NOT NULL THEN char(10)||'工作项：'||COALESCE((SELECT title FROM work_items WHERE id=l.work_item_id),l.work_item_id) ELSE '' END,char(10)||char(10)) FROM source_links l JOIN source_clauses c ON c.id=l.clause_id JOIN source_documents d ON d.id=c.document_id JOIN source_revisions v ON v.id=c.current_revision_id WHERE l.requirement_id=requirements.id) FROM "requirements";

--> statement-breakpoint

DROP TABLE "requirements";

--> statement-breakpoint

ALTER TABLE "__workflow_requirements" RENAME TO "requirements";

--> statement-breakpoint

CREATE INDEX `idx_requirements_project_status` ON `requirements` (`project_id`,`status`,`deleted_at`);

--> statement-breakpoint

CREATE INDEX `idx_requirements_template` ON `requirements` (`template_id`);

--> statement-breakpoint

CREATE INDEX `idx_requirements_owner` ON `requirements` (`owner_id`);

--> statement-breakpoint

CREATE INDEX requirements_group ON requirements(group_id);

--> statement-breakpoint

UPDATE projects SET analysis_revision=analysis_revision+1;

--> statement-breakpoint
CREATE TRIGGER delivery_commitment_revision AFTER INSERT ON delivery_commitments BEGIN

 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id;

END;
--> statement-breakpoint
CREATE TRIGGER delivery_requirement_fields AFTER UPDATE OF delivery_scope,execution_mode,acceptance_owner_id,actual_start,actual_end,blocked_at,blocked_reason,duration_days,forecast_end,forecast_duration,forecast_ready_at,unblock_estimate,split_base_progress,split_at ON requirements BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER editor_dependency_edges_delete AFTER DELETE ON dependency_edges BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;
--> statement-breakpoint
CREATE TRIGGER editor_dependency_edges_insert AFTER INSERT ON dependency_edges BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER editor_dependency_edges_update AFTER UPDATE ON dependency_edges BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER editor_milestones_delete AFTER DELETE ON milestones BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;
--> statement-breakpoint
CREATE TRIGGER editor_milestones_insert AFTER INSERT ON milestones BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER editor_milestones_update AFTER UPDATE ON milestones BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_clause_insert AFTER INSERT ON source_clauses BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM source_documents WHERE id=NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_clause_update AFTER UPDATE ON source_clauses BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM source_documents WHERE id=NEW.document_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_document_insert AFTER INSERT ON source_documents BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_document_update AFTER UPDATE ON source_documents BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_group_delete AFTER DELETE ON requirement_groups BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_group_insert AFTER INSERT ON requirement_groups BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_group_update AFTER UPDATE ON requirement_groups BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
--> statement-breakpoint
CREATE TRIGGER intake_link_delete AFTER DELETE ON source_links BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=OLD.requirement_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_link_insert AFTER INSERT ON source_links BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=NEW.requirement_id); END;
--> statement-breakpoint
CREATE TRIGGER intake_link_update AFTER UPDATE ON source_links BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=NEW.requirement_id); END;
--> statement-breakpoint
CREATE TRIGGER path_project_update AFTER UPDATE OF name, planned_start, planned_end, status, deleted_at ON projects BEGIN

 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.id;

END;
--> statement-breakpoint
CREATE TRIGGER path_requirement_delete AFTER DELETE ON requirements BEGIN

 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=OLD.project_id;

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
CREATE TRIGGER path_work_delete AFTER DELETE ON work_items BEGIN

 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=OLD.requirement_id);

END;
--> statement-breakpoint
CREATE TRIGGER path_work_insert AFTER INSERT ON work_items BEGIN

 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=(SELECT project_id FROM requirements WHERE id=NEW.requirement_id);

END;
--> statement-breakpoint
CREATE TRIGGER path_work_update AFTER UPDATE ON work_items BEGIN

 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id IN (SELECT project_id FROM requirements WHERE id IN (NEW.requirement_id, OLD.requirement_id));

END;
--> statement-breakpoint
CREATE TRIGGER paths_new_work_review AFTER INSERT ON work_items

WHEN (SELECT dependencies_reviewed_at FROM requirements WHERE id=NEW.requirement_id) IS NOT NULL

BEGIN

  UPDATE requirements SET dependencies_reviewed_at=NULL WHERE id=NEW.requirement_id;

END;