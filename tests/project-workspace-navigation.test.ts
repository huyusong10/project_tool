import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {projectTaskUrl,rememberProjectTask,progressEntryParams,initialScopeMode} from '../src/client/project-workspace-navigation';
beforeEach(()=>{const values=new Map<string,string>();vi.stubGlobal('sessionStorage',{getItem:(key:string)=>values.get(key)||null,setItem:(key:string,value:string)=>values.set(key,value)});});
afterEach(()=>vi.unstubAllGlobals());
it('首次默认关系图；只迁移明确保存的表格偏好',()=>{
  expect(initialScopeMode('a','p')).toBe('graph');sessionStorage.setItem('pm-canvas-navigation:a:p:features','mode=table');expect(initialScopeMode('a','p')).toBe('table');expect(initialScopeMode('b','p')).toBe('graph');
});
it('任务切换携带对象，图形筛选不在进展中生效；保留自己的时间筛选',()=>{
  rememberProjectTask('a','p','/execution','?progressStage=testing');
  const url=new URL(projectTaskUrl('a','p','progress',new URLSearchParams('view=requirement&requirementId=r&pathNode=w&featureId=f&phaseId=p1&pathFloat=critical&stage=development')),'http://test');
  expect(url.searchParams.get('pathNode')).toBe('w');expect(url.searchParams.get('phaseId')).toBe('p1');expect(url.searchParams.get('progressStage')).toBe('testing');expect(url.searchParams.has('pathFloat')).toBe(false);expect(url.searchParams.has('stage')).toBe(false);
});
it('旧进展的默认进行中过滤不迁移，明确选择和旧链接条件可见',()=>{
  expect(progressEntryParams('a','p',new URLSearchParams()).size).toBe(0);
  sessionStorage.setItem('pm-path-view:a:p:dashboard-gantt:status','"completed"');
  expect(progressEntryParams('a','p',new URLSearchParams()).get('progressStatus')).toBe('completed');
  sessionStorage.setItem('pm-path-view:a:p:dashboard-gantt:status-v2','"completed"');
  expect(progressEntryParams('a','p',new URLSearchParams()).get('progressStatus')).toBe('completed');
  expect(progressEntryParams('a','p',new URLSearchParams('status=in_progress&risk=high')).toString()).toBe('progressStatus=in_progress&progressRisk=high');
  sessionStorage.setItem('pm-path-view:a:p:dashboard-gantt:status-v2','""');expect(progressEntryParams('a','p',new URLSearchParams()).has('progressStatus')).toBe(false);
});
it('分析页返回原 Phase 范围；账号隔离，不修改未知提交原文',()=>{
  sessionStorage.setItem('pm-graph-draft:a:p:submission','{"original":"unchanged"}');rememberProjectTask('a','p','/execution','?featureId=f&phaseId=p1');
  expect(projectTaskUrl('a','p','progress')).toBe('/execution?featureId=f&phaseId=p1');expect(projectTaskUrl('b','p','progress')).toBe('/execution');expect(sessionStorage.getItem('pm-graph-draft:a:p:submission')).toBe('{"original":"unchanged"}');
});

it('删除旧关注条件，其他范围与待核对提交保持原样',()=>{
  const original='{"action":"progress","percent":75}';sessionStorage.setItem('pm-graph-draft:a:p:submission',original);
  expect(progressEntryParams('a','p',new URLSearchParams('featureId=f&attention=1&progressAttention=1')).toString()).toBe('featureId=f');
  rememberProjectTask('a','p','/execution','?progressAttention=1&progressStage=testing');
  expect(progressEntryParams('a','p',new URLSearchParams()).toString()).toBe('progressStage=testing');
  expect(projectTaskUrl('a','p','progress')).toBe('/execution?progressStage=testing');
  expect(sessionStorage.getItem('pm-graph-draft:a:p:submission')).toBe(original);
});
