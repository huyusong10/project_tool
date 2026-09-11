-- Startup reconciles feature migrations skipped by the former dev branch timestamp.
SELECT expectation, description, archived_at FROM requirement_groups LIMIT 0;
--> statement-breakpoint
SELECT id FROM feature_relations LIMIT 0;
