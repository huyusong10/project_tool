import {matchesSearch} from '../src/shared/search';
import {describe,it,expect} from 'vitest';
import {emptyRequirementFilters,matchesRequirementFilters,compareRiskRequirements,unfinishedStatuses,normalizeRequirementStatusFilter,type RequirementViewItem} from '../src/shared/requirement-view';
import {readPathFilters,writePathFilters,graphBranch,graphContext} from '../src/client/path-view';
const item:RequirementViewItem={title:'需求',status:'in_progress',riskLevel:'high',riskEvaluated:true,ownerId:'owner',assigneeIds:['a','b'],priority:'P3',processingPriority:'P1',scheduleComplete:true,pathRisk:{critical:true,minFloat:0}};
describe('需求显示规则',()=>{
 it('加权搜索不会把无匹配的需求选入结果',()=>{expect(matchesSearch([{text:'订单交付',weight:100}],'dingdan')).toBe(true);expect(matchesSearch([{text:'接口基础',weight:100}],'订单')).toBe(false);});
 it('未结束默认包含未开始和进行中；明确全部与旧链接保持兼容',()=>{expect(readPathFilters(new URLSearchParams()).statuses).toEqual(['not_started','in_progress']);expect(readPathFilters(new URLSearchParams('pathScope=all')).statuses).toEqual([]);expect(readPathFilters(new URLSearchParams('pathScope=attention')).attention).toBe(true);expect(readPathFilters(new URLSearchParams(),true).statuses).toEqual([]);});
 it('升级后旧状态筛选仍能找到对应需求，过时的交付和优先级筛选不再生效',()=>{
   const filters=readPathFilters(new URLSearchParams('pathStatuses=planning,blocked,pending_acceptance,in_progress&pathDeliveryScope=candidate&pathPriorities=P0'));
   expect(filters.statuses).toEqual(['not_started','in_progress','completed']);
   expect(filters.deliveryScopes).toEqual([]);expect(filters.priorities).toEqual([]);
   expect(['not_started','in_progress','completed'].every(status=>matchesRequirementFilters({...item,status},filters))).toBe(true);
   expect(normalizeRequirementStatusFilter('planning')).toBe('not_started');
   expect(normalizeRequirementStatusFilter('obsolete')).toBe('');
   expect(readPathFilters(new URLSearchParams('pathStatuses=unfinished')).statuses).toEqual(unfinishedStatuses);
 });
 it('同字段并集，跨字段交集；人员按 ID，待评估独立于低风险',()=>{const f={...emptyRequirementFilters(),statuses:['blocked','in_progress'],participants:['b','c'],owners:['owner'],priorities:['P1'],critical:true};expect(matchesRequirementFilters(item,f)).toBe(true);expect(matchesRequirementFilters({...item,ownerId:'another'},f)).toBe(false);expect(matchesRequirementFilters({...item,riskEvaluated:false},{...emptyRequirementFilters(),risks:['pending']})).toBe(true);expect(matchesRequirementFilters({...item,riskEvaluated:false},{...emptyRequirementFilters(),risks:['low']})).toBe(false);});
 it('URL 往返保留空状态集合、多人和既有分析目标',()=>{const f={...emptyRequirementFilters(),participants:['a','b'],risks:['high'],critical:true};const url=writePathFilters(new URLSearchParams('target=project'),f);expect(readPathFilters(url)).toEqual(f);expect(url.get('target')).toBe('project');});
 it('旧关键与异常链接包含交付条件未知的非关键需求',()=>{expect(matchesRequirementFilters({...item,riskLevel:'medium',pathRisk:{},unknown:true},readPathFilters(new URLSearchParams('pathScope=attention')))).toBe(true);});
 it('排序将结束项置后，同风险优先关键阻塞',()=>{const values=[{...item,title:'结束',status:'completed'},{...item,title:'普通',pathRisk:{}},{...item,title:'阻塞',pathRisk:{blockedCritical:true}}];expect(values.sort(compareRiskRequirements).map(i=>i.title)).toEqual(['阻塞','普通','结束']);});
 it('聚焦包含上游与下游，不吞入同一上游的其他分支；上下文只补一层',()=>{const edges=[{source:'a',target:'b'},{source:'b',target:'c'},{source:'a',target:'d'}];expect([...graphBranch('b',edges)].sort()).toEqual(['a','b','c']);expect([...graphContext(new Set(['c']),edges)].sort()).toEqual(['b','c']);});
});
