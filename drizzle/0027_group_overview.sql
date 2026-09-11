ALTER TABLE requirement_groups ADD COLUMN expectation text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE requirement_groups ADD COLUMN progress_summary text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE requirement_groups ADD COLUMN assessment text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE requirement_groups ADD COLUMN assessment_note text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE requirement_groups ADD COLUMN assessed_at text;
--> statement-breakpoint
ALTER TABLE requirement_groups ADD COLUMN assessed_by text REFERENCES accounts(id) ON DELETE SET NULL;
