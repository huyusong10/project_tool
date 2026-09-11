import { describe, expect, it } from 'vitest';
import { templateOverview } from '../src/client/template-overview';
import type { TemplateItem } from '../src/client/types';

const item = (id: string, start: number, duration: number, predecessorIds: string[] = [], kind: 'work' | 'milestone' = 'work'): TemplateItem => ({ id, title: id, templateId: 't', sortOrder: 0, kind, startOffsetDays: start, durationDays: duration, predecessorIds, milestoneLabel: null });
describe('流程概览', () => {
  it('分支与汇合按真实依赖分层，计划跨度不累加并行工期', () => {
    const items = [item('设计',0,2),item('前端',2,3,['设计']),item('后端',2,5,['设计']),item('基线',7,0,['前端','后端'],'milestone'),item('测试',7,2,['基线'])];
    const before = structuredClone(items);
    const result = templateOverview({items,dependencyMode:'dependencies'});
    expect(result.levels.map(level=>level.items.map(item=>item.id))).toEqual([['设计'],['前端','后端'],['基线'],['测试']]);
    expect(result).toMatchObject({workCount:4,milestoneCount:1,span:9});
    expect(result.edges).toHaveLength(5);
    expect(items).toEqual(before);
  });
  it('旧流程按计划时间显示，不把时间相邻误认为依赖', () => {
    const result = templateOverview({items:[item('设计',0,2),item('开发',2,3)],dependencyMode:'legacy'});
    expect(result.dependencies).toBe(false);
    expect(result.edges).toEqual([]);
    expect(result.levels.map(level=>level.rank)).toEqual([0,2]);
  });
  it('旧里程碑标签可见，迁移后不重复计数，零时长里程碑不增加一天', () => {
    const work = {...item('w',0,3),milestoneLabel:'发布'};
    const legacy = templateOverview({items:[work]});
    expect(legacy).toMatchObject({workCount:1,milestoneCount:1,span:3});
    const migrated = templateOverview({items:[work,{...item('m',3,0,['w'],'milestone'),title:'发布'}]});
    expect(migrated.nodes).toHaveLength(2);
    expect(migrated.milestoneCount).toBe(1);
  });
  it('缺失依赖与环路不画虚假连线，空流程可正常显示', () => {
    expect(templateOverview({items:[]})).toMatchObject({nodes:[],span:0,workCount:0,milestoneCount:0});
    for (const items of [[item('a',0,1,['missing'])],[item('a',0,1,['b']),item('b',1,1,['a'])]]) {
      const result = templateOverview({items,dependencyMode:'dependencies'});
      expect(result.invalidDependencies).toBe(true);
      expect(result.edges).toEqual([]);
      expect(result.nodes).toHaveLength(items.length);
    }
  });
});
