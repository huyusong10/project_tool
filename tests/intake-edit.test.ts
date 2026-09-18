import { expect,it } from 'vitest';
import { intakeExample, intakePackageSchema } from '../src/shared/intake';
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

it('合并保留双方关联链接，规范化后的同址链接沿用目标名称，旧来源不被覆盖',()=>{
  const pkg=intakePackageSchema.parse({formatVersion:3,requirements:[
    {key:'target',title:'目标',referenceLinks:[{title:'目标文档',url:'https://example.com',kind:'document'}]},
    {key:'source',title:'来源',referenceLinks:[{title:'另一名称',url:'https://EXAMPLE.com/',kind:'other'},{title:'任务',url:'https://example.com/browse/PM-1',kind:'task'}]},
  ]});
  const before=structuredClone(pkg),merged=mergeIntakeRequirements(pkg,'source','target');
  expect(merged.requirements[0].referenceLinks).toEqual([pkg.requirements[0].referenceLinks![0],pkg.requirements[1].referenceLinks![1]]);
  expect(pkg).toEqual(before);
  pkg.requirements[0].referenceLinks=undefined;pkg.requirements[0].referenceUrl='https://legacy.example.com/spec';
  expect(mergeIntakeRequirements(pkg,'source','target').requirements[0].referenceLinks?.map(link=>link.url))
    .toEqual(['https://legacy.example.com/spec','https://EXAMPLE.com/','https://example.com/browse/PM-1']);
});

it('合并后超过20个关联链接时全部保留，留给用户修正而不截断',()=>{
  const links=Array.from({length:21},(_,i)=>({title:`文档${i}`,url:`https://example.com/${i}`,kind:'document' as const}));
  const pkg=intakePackageSchema.parse({formatVersion:3,requirements:[
    {key:'target',title:'目标',referenceLinks:links.slice(0,20)},
    {key:'source',title:'来源',referenceLinks:links.slice(20)},
  ]});
  const merged=mergeIntakeRequirements(pkg,'source','target');
  expect(merged.requirements[0].referenceLinks).toEqual(links);
  const checked=intakePackageSchema.safeParse(merged);expect(checked.success).toBe(false);
  if(!checked.success)expect(checked.error.issues[0].message).toBe('最多关联 20 个链接');
  expect(pkg.requirements).toHaveLength(2);
});
