import { expect, it } from 'vitest';
import { migrateFeatureFields, migrateImportDraft, migrateFeatureSearch } from '../src/client/feature-storage-migration';
it('旧草稿归属、筛选和脏字段改名，用户原文保持不变', () => {
  const raw = { draft: { groupId: 'f', title: '原文 groupId 与分组不改写' }, dirtyFields: ['groupId', 'title'], filters: { groups: ['f'] }, fields: { 'r:groupId': { value: 'f' } } };
  expect(migrateFeatureFields(raw)).toEqual({ draft: { featureId: 'f', title: '原文 groupId 与分组不改写' }, dirtyFields: ['featureId', 'title'], filters: { features: ['f'] }, fields: { 'r:featureId': { value: 'f' } } });
  expect(raw.draft.groupId).toBe('f');
});
it('待核对批次和请求保持原样，未发送的导入草稿升级为版本 3', () => {
  const pending = { batchId: 'old-request', package: { formatVersion: 2, requirements: [{ group: '资产', groupId: 'f' }] } };
  expect(migrateFeatureFields(pending)).toBe(pending);
  const next = migrateImportDraft({ formatVersion: 2, requirements: [{ group: '资产', title: 'Phase 1 不应自动安排' }] });
  expect(next).toEqual({ formatVersion: 3, requirements: [{ feature: '资产', title: 'Phase 1 不应自动安排' }] });
  expect(migrateImportDraft(next)).toBe(next);
});

it('保存的特性筛选迁移名称，保留其余参数和已保存的新字段', () => {
  expect(migrateFeatureSearch('?group=ungrouped&pathGroups=f,ungrouped&q=groupId')).toBe('q=groupId&feature=unassigned&pathFeatures=f%2Cunassigned');
  expect(migrateFeatureSearch('group=old&feature=new&scroll=40')).toBe('feature=new&scroll=40');
  expect(migrateFeatureSearch('')).toBe('');
});
