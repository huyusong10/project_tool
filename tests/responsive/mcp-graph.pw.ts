import { test, expect } from '@playwright/test';
import { addBusinessDays, todayIso } from '../../src/shared/domain';
import {phaseFixture} from './phase-fixture';

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

test('MCP Phase 图展示交付批次、空范围和跨期依赖，文字与卡片保持在边界内',async({page},info)=>{
  const f=await phaseFixture(page);
  const auth=await(await page.request.post('/api/tokens',{data:{name:'Phase图验证'}})).json();
  const before=await(await page.request.get(f.base+'/path-analysis')).json();
  const chain:string[]=[f.testing.id];
  for(let i=0;i<3;i++){
    const response=await page.request.post('/api/requirements',{data:{projectId:f.projectId,featureId:f.feature.id,phaseId:f.phases[2].id,title:'DCIM-10'+i+' 多站点采集与指标建模交付边界验证 '.repeat(3)}});
    expect(response.ok(),await response.text()).toBe(true);chain.push((await response.json()).id);
  }
  for(let i=1;i<chain.length;i++){
    const analysis=await(await page.request.get(f.base+'/path-analysis')).json();
    const response=await page.request.post(f.base+'/dependencies',{data:{expectedRevision:analysis.revision,sourceRequirementId:chain[i-1],targetRequirementId:chain[i]}});
    expect(response.ok(),await response.text()).toBe(true);
  }
  const empty=await(await page.request.post(f.base+'/features/'+f.feature.id+'/phases',{data:{name:'远期范围 <待讨论&确认>',scope:'长范围说明：采集、存储、指标、资产、权限及租户之间的交付边界。'.repeat(3)}})).json();
  const current=await(await page.request.get(f.base+'/path-analysis')).json();
  for(const view of ['feature','features']){
    const response=await page.request.post('/mcp',{headers:{authorization:'Bearer '+auth.token,accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_path_graph',arguments:{projectId:f.projectId,view,...(view==='feature'?{featureId:f.feature.id}:{}),format:'svg'}}}});
    const body=await response.json();expect(body.result.isError,JSON.stringify(body)).not.toBe(true);const graph=body.result.structuredContent.result;
    await page.setContent('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><body style="margin:24px">'+graph.svg+'</body></html>');
    await expect(page.locator('svg')).toContainText(empty.name);await expect(page.locator('script')).toHaveCount(0);
    if(view==='feature'){
      await expect(page.locator('svg')).toContainText('测试中 · 70%');
      expect(graph.links.length).toBeGreaterThanOrEqual(3);
      expect(graph.layout.regions.find((r:{id:string})=>r.id===f.phases[2].id).width).toBeGreaterThan(900);
    }
    const overflow=await page.locator('svg').evaluate(svg=>{
      const errors:string[]=[];
      for(const card of svg.querySelectorAll('[data-card]')){
        const size=card.querySelector('rect')!.getBBox();
        for(const text of card.querySelectorAll('text')){const box=text.getBBox();if(box.x<0||box.y<0||box.x+box.width>size.width+1||box.y+box.height>size.height+1)errors.push(text.textContent||'');}
      }
      for(const region of svg.querySelectorAll('[data-phase-region]')){
        const size=region.querySelector('rect')!.getBBox();
        for(const text of region.querySelectorAll('text')){const box=text.getBBox();if(box.x<size.x||box.x+box.width>size.x+size.width+1||box.y+box.height>size.y+148)errors.push(text.textContent||'');}
      }
      return errors;
    });
    expect(overflow).toEqual([]);
    await page.locator('svg').screenshot({path:info.outputPath('mcp-phase-'+view+'.png')});
  }
  expect(await(await page.request.get(f.base+'/path-analysis')).json()).toEqual(current);
  expect(current.requirements.length).toBe(before.requirements.length+3);
});
