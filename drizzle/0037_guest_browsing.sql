ALTER TABLE projects ADD COLUMN guest_visible INTEGER NOT NULL DEFAULT 0 CHECK (guest_visible IN (0, 1));
