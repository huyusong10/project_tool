import { expect, it } from 'vitest';
import { queryAnalytics } from '../src/server/analytics';
import type { AnalyticsPanelConfig } from '../src/shared/analytics';
import { createTestDatabase } from './support/test-app';

it.each([
  { dataset: 'progress', measure: 'update_count', unit: 'count' },
  { dataset: 'requirements', measure: 'finish_variance', unit: 'days' },
])('$dataset 按需求统计不合并同名对象，排序和改名保留需求身份', async ({ dataset, measure, unit }) => {
  const fixture = await createTestDatabase(), db = fixture.context.sqlite;
  const now = '2026-09-04T04:00:00.000Z';
  try {
    db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('p1', '当前项目', now, now);
    db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('p2', '其他项目', now, now);
    const insert = db.prepare(`INSERT INTO requirements
      (id,project_id,title,status,execution_mode,planned_start,planned_end,actual_start,actual_end,progress,created_at,updated_at,deleted_at)
      VALUES (?,?,'同名需求','completed','direct','2026-09-01','2026-09-02','2026-09-01',?,100,?,?,?)`);
    const update = db.prepare(`INSERT INTO progress_updates
      (id,requirement_id,percent,content,event_type,created_at,updated_at) VALUES(?,?,100,'处理说明','note',?,?)`);
    for (const [id, projectId, end, deletedAt, count] of [
      ['r1', 'p1', '2026-09-03', null, 1], ['r2', 'p1', '2026-09-04', null, 2],
      ['archived', 'p1', '2026-09-04', now, 3], ['foreign', 'p2', '2026-09-04', null, 4],
    ] as const) {
      insert.run(id, projectId, end, now, now, deletedAt);
      for (let index = 0; index < count; index++) update.run(id + '-' + index, id, now, now);
    }
    const panel: AnalyticsPanelConfig = { id: 'groups', title: '逐需求统计', dataset, measure,
      dimension: 'requirement', visualization: 'table', size: 'medium', timeScope: 'snapshot', sort: 'desc' };
    const query = (changes: Partial<AnalyticsPanelConfig> = {}) => fixture.run(() => queryAnalytics({
      projectId: 'p1', range: { from: '2026-09-01', to: '2026-09-30' }, panels: [{ ...panel, ...changes }],
    })).results[0];
    const snapshot = () => ['projects', 'requirements', 'progress_updates', 'analytics_layouts', 'audit_logs']
      .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot(), changes = db.prepare('SELECT total_changes() AS n').get();
    const rows = [{ key: 'r2', label: '同名需求', value: 2 }, { key: 'r1', label: '同名需求', value: 1 }]
      .map(row => unit === 'days' ? { ...row, sampleCount: 1 } : row);
    expect(query()).toMatchObject({ unit, rows });
    expect(query({ limit: 1 }).rows).toEqual(rows.slice(0, 1));
    expect(query({ sort: 'asc' }).rows).toEqual([...rows].reverse());
    expect(snapshot()).toEqual(before);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
    db.prepare("UPDATE requirements SET title='更名后的需求' WHERE id='r1'").run();
    expect(query().rows).toEqual([rows[0], { ...rows[1], label: '更名后的需求' }]);
  } finally {
    fixture.close();
  }
});
