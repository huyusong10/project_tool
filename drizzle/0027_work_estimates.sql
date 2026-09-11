ALTER TABLE work_items ADD COLUMN progress_weight INTEGER CHECK (progress_weight IS NULL OR progress_weight >= 1);
