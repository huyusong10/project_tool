import { expect,it } from 'vitest';
import { intakeExample } from '../src/shared/intake';
import { mergeIntakeRequirements,splitIntakeRequirement } from '../src/client/intake-edit';
import { matchesRequirementFilters,emptyRequirementFilters } from '../src/shared/requirement-view';
import { readPathFilters,writePathFilters } from '../src/client/path-view';
it('拆分和合并保留原文、工作及依赖端点',()=>{
  const split=splitIntakeRequirement(intakeExample,'query','second');
  expect(split.requirements).toHaveLength(2);expect(split.requirements[1].background).toBe(intakeExample.requirements[0].background);expect(split.requirements[1].workItems).toEqual([]);
  const merged=mergeIntakeRequirements(split,'query','second');expect(merged.requirements).toHaveLength(1);expect(merged.requirements[0].workItems).toHaveLength(2);
  expect(merged.dependencies[0].source).toEqual({requirement:'second',workItem:'query::api'});expect(intakeExample.requirements[0].key).toBe('query');
});
it('分组筛选可恢复，旧标签条件不再参与筛选',()=>{
  const filters={...emptyRequirementFilters(),features:['g']};
  expect(readPathFilters(writePathFilters(new URLSearchParams('pathTags=%5B%22旧标签%22%5D'),filters))).toEqual(filters);
  const r={title:'资源同步',status:'not_started',riskLevel:'low',riskEvaluated:true,featureId:'g'};
  expect(matchesRequirementFilters(r,filters)).toBe(true);expect(matchesRequirementFilters({...r,featureId:'other'},filters)).toBe(false);expect(r.featureId).toBe('g');
});
