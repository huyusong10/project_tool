UPDATE `requirements`
SET
  `planned_start` = CASE
    WHEN EXISTS (
      SELECT 1 FROM `work_items`
      WHERE `work_items`.`requirement_id` = `requirements`.`id`
        AND `work_items`.`status` <> 'cancelled'
    ) THEN (
      SELECT MIN(`work_items`.`planned_start`) FROM `work_items`
      WHERE `work_items`.`requirement_id` = `requirements`.`id`
        AND `work_items`.`status` <> 'cancelled'
    )
    ELSE `planned_start`
  END,
  `planned_end` = CASE
    WHEN EXISTS (
      SELECT 1 FROM `work_items`
      WHERE `work_items`.`requirement_id` = `requirements`.`id`
        AND `work_items`.`status` <> 'cancelled'
    ) THEN (
      SELECT MAX(`work_items`.`planned_end`) FROM `work_items`
      WHERE `work_items`.`requirement_id` = `requirements`.`id`
        AND `work_items`.`status` <> 'cancelled'
    )
    ELSE `planned_end`
  END;
