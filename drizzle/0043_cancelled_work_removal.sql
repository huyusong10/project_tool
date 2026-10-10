ALTER TABLE progress_updates ADD COLUMN deleted_work_item_id TEXT;
--> statement-breakpoint
ALTER TABLE progress_updates ADD COLUMN deleted_work_item_title TEXT;
--> statement-breakpoint
CREATE TRIGGER preserve_deleted_work_history BEFORE DELETE ON work_items BEGIN
  UPDATE progress_updates SET deleted_work_item_id=OLD.id, deleted_work_item_title=OLD.title, work_item_id=NULL WHERE work_item_id=OLD.id;
END;
--> statement-breakpoint
-- Preserve cancellation evidence for legacy work, including items without progress entries.
INSERT INTO progress_updates(id,requirement_id,work_item_id,percent,work_item_percent,content,event_type,created_at,updated_at)
SELECT 'cancel-removal-'||w.id,w.requirement_id,w.id,r.progress,w.progress,'取消工作项：'||w.title||'；工作项已移除，需要时重新添加。','cancel',w.updated_at,w.updated_at
FROM work_items w JOIN requirements r ON r.id=w.requirement_id WHERE w.status='cancelled'
AND NOT EXISTS(SELECT 1 FROM progress_updates u WHERE u.work_item_id=w.id AND u.event_type='cancel');
--> statement-breakpoint
-- Removing a delivery prerequisite must not automatically achieve its milestone.
UPDATE milestones SET confirmation_mode=CASE WHEN achieved_at IS NULL THEN 'manual' ELSE confirmation_mode END,version=version+1
WHERE legacy_work_item_id IN(SELECT id FROM work_items WHERE status='cancelled')
OR id IN(SELECT target_milestone_id FROM dependency_edges WHERE source_work_item_id IN(SELECT id FROM work_items WHERE status='cancelled'));
--> statement-breakpoint
UPDATE milestones SET legacy_work_item_id=NULL WHERE legacy_work_item_id IN(SELECT id FROM work_items WHERE status='cancelled');
--> statement-breakpoint
DELETE FROM dependency_edges WHERE source_work_item_id IN(SELECT id FROM work_items WHERE status='cancelled') OR target_work_item_id IN(SELECT id FROM work_items WHERE status='cancelled');
--> statement-breakpoint
DELETE FROM work_item_collaborators WHERE work_item_id IN(SELECT id FROM work_items WHERE status='cancelled');
--> statement-breakpoint
DELETE FROM source_links WHERE work_item_id IN(SELECT id FROM work_items WHERE status='cancelled');
--> statement-breakpoint
UPDATE requirements SET version=version+1 WHERE id IN(SELECT requirement_id FROM work_items WHERE status='cancelled');
--> statement-breakpoint
UPDATE requirements SET actual_start=(SELECT MIN(d) FROM (SELECT requirements.actual_start AS d UNION ALL SELECT w.actual_start FROM work_items w WHERE w.requirement_id=requirements.id)) WHERE id IN(SELECT requirement_id FROM work_items WHERE status='cancelled');
--> statement-breakpoint
UPDATE requirements SET execution_mode='direct',split_base_progress=0,split_at=NULL WHERE execution_mode='work_items'
AND EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id AND w.status='cancelled')
AND NOT EXISTS(SELECT 1 FROM work_items w WHERE w.requirement_id=requirements.id AND w.status<>'cancelled');
--> statement-breakpoint
DELETE FROM work_items WHERE status='cancelled';
