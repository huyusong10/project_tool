ALTER TABLE `requirements` ADD `template_id` text REFERENCES work_item_templates(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `requirements`
SET `template_id` = (
  SELECT ti.`template_id`
  FROM `work_items` w
  JOIN `template_items` ti ON ti.`id` = w.`template_item_id`
  WHERE w.`requirement_id` = `requirements`.`id`
  GROUP BY ti.`template_id`
  ORDER BY COUNT(*) DESC, ti.`template_id`
  LIMIT 1
)
WHERE `template_id` IS NULL;--> statement-breakpoint
UPDATE `issues` SET `due_date` = NULL WHERE `status` = 'deferred';--> statement-breakpoint
CREATE INDEX `idx_requirements_template` ON `requirements` (`template_id`);
