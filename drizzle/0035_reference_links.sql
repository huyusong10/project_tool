ALTER TABLE requirements ADD COLUMN reference_links TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE work_items ADD COLUMN reference_links TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE feature_phases ADD COLUMN reference_links TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
UPDATE requirements SET reference_links=json_array(json_object('title','参考资料','url',reference_url)) WHERE reference_url IS NOT NULL AND trim(reference_url)<>'';
