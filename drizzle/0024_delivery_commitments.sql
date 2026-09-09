CREATE TABLE delivery_commitments (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  confirmed_at TEXT NOT NULL,
  snapshot TEXT NOT NULL CHECK(json_valid(snapshot))
);
--> statement-breakpoint
CREATE INDEX delivery_commitments_project_date ON delivery_commitments(project_id,confirmed_at);
--> statement-breakpoint
ALTER TABLE requirements ADD COLUMN forecast_review TEXT;
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN forecast_review TEXT;
--> statement-breakpoint
ALTER TABLE requirements ADD COLUMN blocked_coordinator_id TEXT REFERENCES people(id);
--> statement-breakpoint
ALTER TABLE requirements ADD COLUMN blocked_next_review_at TEXT;
--> statement-breakpoint
ALTER TABLE requirements ADD COLUMN blocked_issue_id TEXT REFERENCES issues(id);
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN blocked_coordinator_id TEXT REFERENCES people(id);
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN blocked_next_review_at TEXT;
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN blocked_issue_id TEXT REFERENCES issues(id);
--> statement-breakpoint
ALTER TABLE issues ADD COLUMN next_review_at TEXT;
--> statement-breakpoint
CREATE TRIGGER delivery_commitment_revision AFTER INSERT ON delivery_commitments BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id;
END;
--> statement-breakpoint
CREATE TRIGGER blocker_issue_revision AFTER UPDATE OF owner_id,next_review_at,status,requirement_id ON issues BEGIN
 UPDATE projects SET analysis_revision=analysis_revision+1 WHERE id=NEW.project_id AND
 (EXISTS(SELECT 1 FROM work_items WHERE blocked_issue_id=NEW.id) OR EXISTS(SELECT 1 FROM requirements WHERE blocked_issue_id=NEW.id));
END;
