import type Database from 'better-sqlite3';

type DatabaseReader = Pick<InstanceType<typeof Database>, 'pragma' | 'prepare'>;

export type DatabaseConsistency = {
  foreignKeys: number;
  projectScope: {
    projectDefaults: number;
    requirementTemplates: number;
    workItemTemplates: number;
  };
  state: {
    workItems: number;
    requirements: number;
    issues: number;
  };
};

/**
 * 检查完成当前版本迁移后的数据库。启动和恢复准备共用这里，避免恢复成功后才发现服务无法启动。
 */
export function inspectDatabaseConsistency(database: DatabaseReader): DatabaseConsistency {
  const foreignKeys = (database.pragma('foreign_key_check') as Array<Record<string, unknown>>).length;
  const projectScope = database.prepare(`SELECT
    (SELECT COUNT(*) FROM projects p JOIN work_item_templates t ON t.id=p.default_template_id WHERE t.project_id<>p.id) AS projectDefaults,
    (SELECT COUNT(*) FROM requirements r JOIN work_item_templates t ON t.id=r.template_id WHERE t.project_id<>r.project_id) AS requirementTemplates,
    (SELECT COUNT(*) FROM work_items w JOIN requirements r ON r.id=w.requirement_id
      JOIN template_items i ON i.id=w.template_item_id JOIN work_item_templates t ON t.id=i.template_id
      WHERE t.project_id<>r.project_id) AS workItemTemplates`).get() as DatabaseConsistency['projectScope'];
  const state = database.prepare(`SELECT
    (SELECT COUNT(*) FROM work_items WHERE
      (status='not_started' AND (progress<>0 OR actual_start IS NOT NULL OR actual_end IS NOT NULL OR blocked_at IS NOT NULL)) OR
      (status='in_progress' AND (progress>=100 OR actual_start IS NULL OR actual_end IS NOT NULL OR blocked_at IS NOT NULL)) OR
      status NOT IN ('not_started','in_progress','completed','cancelled') OR
      (status='completed' AND (progress<>100 OR actual_start IS NULL OR actual_end IS NULL OR blocked_at IS NOT NULL)) OR
      (status='cancelled' AND (progress>=100 OR actual_end IS NOT NULL OR blocked_at IS NOT NULL))) AS workItems,
    (SELECT COUNT(*) FROM requirements WHERE
      status NOT IN ('not_started','in_progress','completed','cancelled') OR
      (status='completed' AND progress<>100) OR
      (status<>'completed' AND progress>=100)) AS requirements,
    (SELECT COUNT(*) FROM issues WHERE
      (status='resolved' AND (progress<>100 OR resolved_at IS NULL)) OR
      (status<>'resolved' AND (progress>=100 OR resolved_at IS NOT NULL)) OR
      (status='deferred' AND due_date IS NOT NULL)) AS issues`).get() as DatabaseConsistency['state'];
  return { foreignKeys, projectScope, state };
}
