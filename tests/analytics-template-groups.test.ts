import { expect, it } from 'vitest';
import { hashPassword } from '../src/server/auth';
import type { AnalyticsPanelConfig, AnalyticsQueryResponse } from '../src/shared/analytics';
import { createTestApp } from './support/test-app';

it('流程归档后复用名称仍分别统计，未绑定分组不与同名流程混合', async () => {
  const fixture = await createTestApp(), db = fixture.context.sqlite;
  try {
    const password = 'template-group-test-password';
    db.prepare("UPDATE accounts SET password_hash=? WHERE username='admin'").run(hashPassword(password));
    const login = await fixture.app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password } });
    expect(login.statusCode).toBe(200);
    const headers = { cookie: login.cookies.map(c => c.name + '=' + c.value).join('; ') };
    const command = async (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload: object) => {
      const response = await fixture.app.inject({ method, url, headers, payload });
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    };
    const project = await command('POST', '/api/projects', { name: '流程分组核对' });
    const template = (name: string) => command('POST', '/api/templates', { projectId: project.id, name,
      items: [{ title: '交付', durationDays: 1, startOffsetDays: 0, sortOrder: 0 }] });
    const requirements = async (templateId: string | null, count: number) => {
      for (let index = 0; index < count; index++) await command('POST', '/api/requirements', {
        projectId: project.id, title: '需求 ' + templateId + ' ' + index,
        ...(templateId ? { templateId } : {}),
      });
    };
    const old = await template('交付流程');
    await requirements(old.id, 1);
    await command('DELETE', '/api/templates/' + old.id, { expectedUpdatedAt: old.updatedAt });
    const current = await template('交付流程');
    await requirements(current.id, 2);
    await requirements(null, 3);
    const namedUnbound = await template('未绑定流程');
    await requirements(namedUnbound.id, 4);
    const panel: AnalyticsPanelConfig = { id: 'templates', title: '按流程统计', dataset: 'requirements',
      measure: 'count', secondaryMeasure: 'active_count', dimension: 'template', visualization: 'table',
      size: 'medium', timeScope: 'snapshot', sort: 'desc' };
    const query = async (changes: Partial<AnalyticsPanelConfig> = {}) => {
      const response = await command('POST', '/api/analytics/query', { projectId: project.id,
        range: { from: '2026-09-01', to: '2026-09-30' }, panels: [{ ...panel, ...changes }] }) as AnalyticsQueryResponse;
      return response.results[0];
    };
    const snapshot = () => ['projects', 'work_item_templates', 'template_items', 'requirements', 'work_items', 'audit_logs', 'analytics_layouts']
      .map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = snapshot(), totalChanges = db.prepare('SELECT total_changes() AS n').get();
    const rows = [
      { key: namedUnbound.id, label: '未绑定流程', value: 4, secondaryValue: 4 },
      { key: 'unbound', label: '未绑定流程', value: 3, secondaryValue: 3 },
      { key: current.id, label: '交付流程', value: 2, secondaryValue: 2 },
      { key: old.id, label: '交付流程', value: 1, secondaryValue: 1 },
    ];
    expect((await query()).rows).toEqual(rows);
    expect((await query({ sort: 'asc' })).rows).toEqual([...rows].reverse());
    expect((await query({ limit: 1 })).rows).toEqual(rows.slice(0, 1));
    expect(snapshot()).toEqual(before);
    expect(db.prepare('SELECT total_changes() AS n').get()).toEqual(totalChanges);
    await command('PATCH', '/api/templates/' + current.id, { expectedUpdatedAt: current.updatedAt, name: '新的交付流程' });
    expect((await query()).rows).toEqual(rows.map(row => row.key === current.id ? { ...row, label: '新的交付流程' } : row));
  } finally { await fixture.close(); }
});
