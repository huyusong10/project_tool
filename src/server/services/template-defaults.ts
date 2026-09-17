

import { randomUUID } from 'node:crypto';

import { getDatabaseContext } from '../database-context';

import { row } from './support';

const initialFlowItems = [
  { title: '设计', startOffsetDays: 0, durationDays: 2 },
  { title: '开发', startOffsetDays: 2, durationDays: 5 },
  { title: '测试', startOffsetDays: 7, durationDays: 3 },
  { title: '发布', startOffsetDays: 10, durationDays: 1 },
] as const;

export function createInitialProjectFlow(projectId: string, createdAt: string) {
  const templateId = randomUUID();
  getDatabaseContext().sqlite.prepare(`INSERT INTO work_item_templates (id, project_id, name, description, created_at, updated_at)
    VALUES (?, ?, '通用研发流程', '项目初始流程，可由项目经理按实际情况调整。', ?, ?)`)
    .run(templateId, projectId, createdAt, createdAt);
  const insert = getDatabaseContext().sqlite.prepare(`INSERT INTO template_items
    (id, template_id, title, sort_order, start_offset_days, duration_days) VALUES (?, ?, ?, ?, ?, ?)`);
  initialFlowItems.forEach((item, index) => insert.run(randomUUID(), templateId, item.title, index, item.startOffsetDays, item.durationDays));
  return templateId;
}

export function firstActiveTemplateId(projectId: string) {
  return row<{ id: string }>(`SELECT id FROM work_item_templates WHERE project_id=? AND deleted_at IS NULL
    ORDER BY CASE WHEN name='DCIM AI工作流' THEN 0 ELSE 1 END, created_at LIMIT 1`, projectId)?.id || null;
}
