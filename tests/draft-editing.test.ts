import {it,expect} from 'vitest';
import {emptyDraftContent} from '../src/shared/requirement-drafts';
import {mergeDraftDocument,moveDraftWork,removeDraftEntities,removalImpact,mergeDraftRequirements} from '../src/shared/draft-editing';
it('三方合并保留不同字段的修改，重叠及删除冲突由人类选择',()=>{
  const content=emptyDraftContent();content.entities=[{id:'a',entity:'requirement',data:{title:'原始',acceptanceCriteria:'验证'}}];const base={title:'方案',content},local=structuredClone(base),remote=structuredClone(base);
  local.content.entities[0].data.title='网页';remote.content.entities[0].data.background='Agent 边界';
  const first=mergeDraftDocument(base,local,remote);expect(first.conflicts).toEqual([]);expect(first.document.content.entities[0].data).toMatchObject({title:'网页',background:'Agent 边界'});
  remote.content.entities=[];const second=mergeDraftDocument(base,local,remote);expect(second.conflicts).toHaveLength(1);
  expect(mergeDraftDocument(base,local,remote,{[second.conflicts[0].path]:'remote'}).document.content.entities).toEqual([]);
});
it('移动、合并及删除显式处理来源与依赖，不静默删前置',()=>{
  const c=emptyDraftContent();c.entities=[{id:'a',entity:'requirement',data:{title:'A'}},{id:'b',entity:'requirement',data:{title:'B'}},{id:'w',entity:'work',requirementId:'a',data:{title:'共享'}}];c.links=[{document:'doc',clause:'c',requirementId:'a',workItemId:'w',scope:'共享成果'}];c.dependencies=[{clientId:'edge',sourceRequirementId:'a',sourceWorkItemId:'w',targetRequirementId:'b',targetWorkItemId:null}];
  const moved=moveDraftWork(c,'w','b');expect(moved.dependencies[0].sourceRequirementId).toBe('b');expect(moved.links[0].requirementId).toBe('b');
  const merged=mergeDraftRequirements(c,'a','b');expect(merged.dependencies).toHaveLength(1);expect(merged.entities).toHaveLength(2);
  expect(removalImpact(c,['w'])).toMatchObject({dependencies:[c.dependencies[0]],links:[c.links[0]]});expect(removeDraftEntities(c,['w']).dependencies).toEqual([]);expect(removeDraftEntities(c,['w']).links).toEqual([]);
});
