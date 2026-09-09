ALTER TABLE requirements ADD delivery_scope text NOT NULL DEFAULT 'committed' CHECK(delivery_scope IN ('committed','candidate'));
--> statement-breakpoint
ALTER TABLE requirements ADD execution_mode text NOT NULL DEFAULT 'work_items' CHECK(execution_mode IN ('direct','work_items'));
--> statement-breakpoint
ALTER TABLE requirements ADD acceptance_owner_id text REFERENCES people(id);
--> statement-breakpoint
ALTER TABLE requirements ADD actual_start text;
--> statement-breakpoint
ALTER TABLE requirements ADD actual_end text;
--> statement-breakpoint
ALTER TABLE requirements ADD blocked_at text;
--> statement-breakpoint
ALTER TABLE requirements ADD blocked_reason text;
--> statement-breakpoint
ALTER TABLE requirements ADD duration_days integer CHECK(duration_days IS NULL OR duration_days>0);
--> statement-breakpoint
ALTER TABLE requirements ADD forecast_end text;
--> statement-breakpoint
ALTER TABLE requirements ADD unblock_estimate text;
--> statement-breakpoint
ALTER TABLE requirements ADD split_base_progress integer NOT NULL DEFAULT 0 CHECK(split_base_progress BETWEEN 0 AND 99);
--> statement-breakpoint
ALTER TABLE requirements ADD split_at text;
--> statement-breakpoint
ALTER TABLE requirements ADD forecast_duration integer;
--> statement-breakpoint
ALTER TABLE requirements ADD forecast_ready_at text;
--> statement-breakpoint
UPDATE requirements SET execution_mode='direct' WHERE NOT EXISTS (SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id);
--> statement-breakpoint
CREATE TRIGGER delivery_requirement_fields AFTER UPDATE OF delivery_scope,execution_mode,acceptance_owner_id,actual_start,actual_end,blocked_at,blocked_reason,duration_days,forecast_end,forecast_duration,forecast_ready_at,unblock_estimate,split_base_progress,split_at ON requirements BEGIN UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id; END;
