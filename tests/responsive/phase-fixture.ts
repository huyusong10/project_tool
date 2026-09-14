import { expect, type Page } from '@playwright/test';
import type { FeaturePhase } from '../../src/shared/feature-phases';
import type { Requirement } from '../../src/client/types';

export async function phaseFixture(page: Page) {
  async function post(url: string, data: unknown) { const response = await page.request.post(url, { data }); expect(response.ok(), await response.text()).toBe(true); return response.json(); }
  const session = await post('/api/login', { username: 'admin', password: '41_xc7q0qOjo4Inw!' });
  const project = await post('/api/projects', { name: 'Phase 页面验证 ' + Date.now() });
  const owner = await post('/api/people', { projectId: project.id, name: 'Phase 负责人 ' + Date.now() });
  const base = '/api/projects/' + project.id;
  const feature = (await post(base + '/features', { name: '资产管理', description: '从基础台账开始逐步交付资产管理', referenceLinks: [{ title: 'MDS', url: 'https://example.com/asset-mds' }] })).features[0];
  const phases: FeaturePhase[] = [];
  for (const [index, scope] of ['基础台账', '批量导入', ''].entries()) phases.push(await post(base + '/features/' + feature.id + '/phases', { name: 'Phase ' + (index + 1), scope, note: index === 1 ? '字段映射待确认' : '' }));
  const create = async (title: string, phaseId: string | null, templateId?: string) => post('/api/requirements', { projectId: project.id, title, ownerId: owner.id, featureId: feature.id, phaseId, reason:'补充本次交付范围', templateId, ...(templateId ? { plannedStart: new Date().toISOString().slice(0, 10) } : {}) });
  let done = await create('DCIM-001 基础台账', phases[0].id); done = await post('/api/requirements/' + done.id + '/start', { expectedVersion: done.version }); await post('/api/requirements/' + done.id + '/complete', { expectedVersion: done.version, content: '验证交付' });
  const updated: FeaturePhase[] = await (await page.request.get(base + '/feature-phases')).json(); await post(base + '/feature-phases/' + phases[0].id + '/deliver', { expectedVersion: updated.find(p => p.id === phases[0].id)!.version });
  const template = await post('/api/templates', { projectId: project.id, name: '阶段工作流', dependencyMode: 'legacy', items: [{ title: '开发', workStage: 'development', durationDays: 99, startOffsetDays: 0, sortOrder: 0 }, { title: '测试', workStage: 'testing', durationDays: 1, startOffsetDays: 0, sortOrder: 1 }] });
  let testing: Requirement = await create('DCIM-002 资产导入', phases[1].id, template.id);
  const dev = await post('/api/work-items/' + testing.workItems[0].id + '/start', { expectedVersion: testing.workItems[0].version, expectedRequirementVersion:testing.version, ownerId: owner.id });
  await post('/api/work-items/' + testing.workItems[0].id + '/complete', { expectedVersion: dev.version });
  testing=await(await page.request.get("/api/requirements/"+testing.id)).json();
  const work = await post('/api/work-items/' + testing.workItems[1].id + '/start', { expectedVersion: testing.workItems[1].version, expectedRequirementVersion:testing.version, ownerId: owner.id });
  await post('/api/requirements/' + testing.id + '/progress', { expectedVersion: work.version, workItemId: work.id, workItemPercent: 70, content: '测试场景完成七成' });
  testing = await (await page.request.get('/api/requirements/' + testing.id)).json();
  let direct = await create('DCIM-003 无预设里程碑', phases[1].id); direct = await post('/api/requirements/' + direct.id + '/start', { expectedVersion: direct.version });
  await page.addInitScript(({ account, id }) => localStorage.setItem('project-manage:selected-project:' + account, id), { account: session.accountId, id: project.id });
  return { projectId: project.id, base, feature, phases, testing, direct };
}