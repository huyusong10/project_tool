-- Keep all existing IDs, execution facts and delivery snapshots. Only null
-- ownership is assigned to the project's ordinary Other feature.
INSERT INTO features(id,project_id,name,description,sort_order,created_at,updated_at)
SELECT lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-8'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),
  p.id,'其他特性','暂未归入其他特性的需求',
  (SELECT coalesce(max(sort_order),-1)+1 FROM features WHERE project_id=p.id),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM projects p WHERE EXISTS(SELECT 1 FROM requirements r WHERE r.project_id=p.id AND r.feature_id IS NULL)
AND NOT EXISTS(SELECT 1 FROM features f WHERE f.project_id=p.id AND f.name='其他特性');
--> statement-breakpoint
INSERT INTO audit_logs(id,actor_type,action,entity_type,entity_id,project_id,summary,created_at)
SELECT lower(hex(randomblob(16))),'system','update','feature',f.id,f.project_id,'升级整理：恢复其他特性，承接尚未关联特性的需求',strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM features f WHERE f.name='其他特性' AND f.archived_at IS NOT NULL AND EXISTS(SELECT 1 FROM requirements r WHERE r.project_id=f.project_id AND r.feature_id IS NULL AND r.deleted_at IS NULL);
--> statement-breakpoint
UPDATE features SET archived_at=NULL,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE name='其他特性' AND archived_at IS NOT NULL AND EXISTS(SELECT 1 FROM requirements r WHERE r.project_id=features.project_id AND r.feature_id IS NULL AND r.deleted_at IS NULL);
--> statement-breakpoint
INSERT INTO audit_logs(id,actor_type,action,entity_type,entity_id,project_id,summary,created_at)
SELECT lower(hex(randomblob(16))),'system','update','requirement',r.id,r.project_id,
  '升级整理：需求从未关联特性归入其他特性；featureId='||(SELECT f.id FROM features f WHERE f.project_id=r.project_id AND f.name='其他特性'),strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM requirements r WHERE r.feature_id IS NULL;
--> statement-breakpoint
UPDATE requirements SET feature_id=(SELECT f.id FROM features f WHERE f.project_id=requirements.project_id AND f.name='其他特性'),version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE feature_id IS NULL;
