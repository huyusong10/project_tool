import { expect,it } from 'vitest';
import { intakeExample } from '../src/shared/intake';
import { mergeIntakeRequirements,splitIntakeRequirement } from '../src/client/intake-edit';
import { matchesRequirementFilters,emptyRequirementFilters } from '../src/shared/requirement-view';
import { readPathFilters,writePathFilters } from '../src/client/path-view';
it('拆出交付复用来源；合并保留工作、落实范围和依赖端点',()=>{
  const split=splitIntakeRequirement(intakeExample,'query-delivery','second');
  expect(split.requirements).toHaveLength(2);expect(split.links).toHaveLength(4);expect(split.requirements[1].workItems).toEqual([]);
  const merged=mergeIntakeRequirements(split,'query-delivery','second');expect(merged.requirements).toHaveLength(1);expect(merged.links).toHaveLength(2);expect(merged.requirements[0].workItems).toHaveLength(2);
  expect(merged.dependencies[0].source).toEqual({requirement:'second',workItem:'query-delivery::api'});expect(intakeExample.requirements[0].key).toBe('query-delivery');
});
it('分组标签筛选只改变匹配，路径URL恢复相同筛选',()=>{
  const filters={...emptyRequirementFilters(),groups:['g'],tags:['边缘,一期']};
  expect(readPathFilters(writePathFilters(new URLSearchParams(),filters))).toEqual(filters);
  const r={title:'资源同步',status:'not_started',riskLevel:'low',riskEvaluated:true,groupId:'g',tags:['中心','边缘,一期']};
  expect(matchesRequirementFilters(r,filters)).toBe(true);expect(matchesRequirementFilters({...r,groupId:'other'},filters)).toBe(false);expect(r.groupId).toBe('g');
});
