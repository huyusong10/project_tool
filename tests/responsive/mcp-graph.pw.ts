import { test, expect } from '@playwright/test';
import { addBusinessDays, todayIso } from '../../src/shared/domain';

test('MCP SVG导出在浏览器正确显示，导出不改写布局或依赖', async ({ page }, info) => {
  const login = await page.request.post('/api/login', { data: { username: 'admin', password: '41_xc7q0qOjo4Inw!' } });
  expect(login.ok()).toBe(true);
  const project = await (await page.request.post('/api/projects', { data: { name: 'MCP导出' + Date.now() } })).json();
  const owner = await (await page.request.post('/api/people', { data: { projectId: project.id, name: '导出负责人' + Date.now() } })).json();
  const templateResponse = await page.request.post('/api/templates', { data: { projectId: project.id, name: '导出流程', dependencyMode: 'dependencies', items: [
    { clientKey: 'a', title: '接口设计 <外部&输入>', durationDays: 2, startOffsetDays: 0, sortOrder: 0, predecessorKeys: [] },
    { clientKey: 'b', title: '实现与集成验证', durationDays: 2, startOffsetDays: 2, sortOrder: 1, predecessorKeys: ['a'] },
  ] } });
  expect(templateResponse.ok()).toBe(true);
  const template = await templateResponse.json();
  const requirementResponse = await page.request.post('/api/requirements', { data: { projectId: project.id, title: '订单接口交付', templateId: template.id, ownerId: owner.id, plannedStart: addBusinessDays(todayIso(), 0) } });
  expect(requirementResponse.ok()).toBe(true);
  const requirement = await requirementResponse.json();
  const token = await (await page.request.post('/api/tokens', { data: { name: '导出验证' } })).json();
  const analysisUrl = '/api/projects/' + project.id + '/path-analysis';
  const before = await (await page.request.get(analysisUrl)).json();
  const response = await page.request.post('/mcp', { headers: { authorization: 'Bearer ' + token.token, accept: 'application/json, text/event-stream' }, data: {
    jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_path_graph', arguments: {
      projectId: project.id, view: 'requirement', requirementId: requirement.id, direction: 'down', format: 'svg',
    } },
  } });
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.result.isError, JSON.stringify(body)).not.toBe(true);
  const graph = body.result.structuredContent.result;
  await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:24px">' + graph.svg + '</body></html>');
  await expect(page.locator('svg')).toBeVisible();
  await expect(page.locator('script')).toHaveCount(0);
  expect(await page.locator('svg > g > g[transform]').count()).toBe(graph.cards.length);
  await expect(page.locator('svg')).toContainText('接口设计 <外部&输入>');
  const bounds = await page.locator('svg').evaluate(svg => {
    const root = (svg as SVGSVGElement).viewBox.baseVal;
    return [...svg.querySelectorAll('g[transform]')].map(node => {
      const box = (node as SVGGraphicsElement).getBBox(), matrix = (node as SVGGraphicsElement).transform.baseVal.consolidate()!.matrix;
      return box.x + matrix.e >= 0 && box.y + matrix.f >= 0 && box.x + matrix.e + box.width <= root.width && box.y + matrix.f + box.height <= root.height;
    });
  });
  expect(bounds.every(Boolean)).toBe(true);
  await page.locator('svg').screenshot({ path: info.outputPath('mcp-graph.svg.png') });
  expect(await (await page.request.get(analysisUrl)).json()).toEqual(before);
});
