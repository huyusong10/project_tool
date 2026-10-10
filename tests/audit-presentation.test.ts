import { expect, it } from 'vitest';
import { auditObjectUrl, auditSummary } from '../src/client/features/audit/presentation';

it('已移除工作显示取消原因和依赖影响，未知快照保留原文', () => {
  const context={action:'cancel',entityType:'work_item'};
  const value={title:'旧渠道核验',reason:'旧渠道停止交付',removedDependencies:[{id:'in'},{id:'out'}],milestones:[{id:'m',title:'发布交付'}]};
  expect(auditSummary(JSON.stringify(value),context)).toBe('旧渠道核验：工作项已移除；取消原因：旧渠道停止交付；已解除 2 条依赖；需人工确认的里程碑：发布交付');
  expect(auditSummary(JSON.stringify({title:'空工作',removedDependencies:[]}),{action:'delete',entityType:'work_item'})).toBe('空工作：工作项已移除');
  for(const original of [JSON.stringify({...value,unknown:'保留'}),JSON.stringify({...value,removedDependencies:null}),JSON.stringify({...value,milestones:[{id:'m'}]})])expect(auditSummary(original,context)).toBe(original);
  expect(auditSummary(JSON.stringify(value),{action:'cancel',entityType:'requirement'})).toBe(JSON.stringify(value));
});

it('已移除工作链接进入所属需求记录，没有保留历史时不提供失效入口', () => {
  const item={entityType:'work_item',entityId:'old-work',projectId:'project',workItemDeleted:true,workItemRequirementId:'original-requirement'};
  const url=new URL(auditObjectUrl(item)!,'http://localhost');
  expect(url.searchParams.get('detailId')).toBe('original-requirement');expect(url.searchParams.get('detailTab')).toBe('history');
  expect(url.searchParams.get('projectId')).toBe('project');
  expect(auditObjectUrl({...item,workItemRequirementId:null})).toBeUndefined();
  expect(new URL(auditObjectUrl({...item,workItemDeleted:false})!,'http://localhost').searchParams.get('detailId')).toBe('old-work');
  expect(auditObjectUrl({...item,objectDeleted:true})).toBe(auditObjectUrl(item));
});

it('已删除对象不进入失效详情，当前对象保留原入口', () => {
  for(const entityType of ['project','feature','feature_phase','requirement','issue']){
    const item={entityType,entityId:'removed',projectId:'project'};
    expect(auditObjectUrl({...item,objectDeleted:true})).toBeUndefined();
    expect(auditObjectUrl({...item,objectDeleted:false})).toBeDefined();
  }
});

it('变更快照优先使用已有文字原因，普通记录和不完整 JSON 保留原文', () => {
  const record=JSON.stringify({reason:'负责人：甲 → 乙',before:{title:'旧名称'},after:{title:'新名称'}});
  expect(auditSummary(record)).toBe('新名称：负责人：甲 → 乙');
  for(const original of ['创建需求：查询','{未完成的JSON','null','[]','{"reason":"仅说明"}','{"before":{},"reason":null}'])expect(auditSummary(original)).toBe(original);
  expect(auditSummary(JSON.stringify({reason:'移除工作',before:{title:'原工作'},after:null}))).toBe('原工作：移除工作');
  expect(auditSummary(JSON.stringify({reason:'修正历史记录',before:{title:'接口核对',nextReviewAt:'2026-09-25',dueDate:null,requirementId:'old'},after:{title:'接口核对',nextReviewAt:'2026-09-28',dueDate:null,requirementId:'new'}}))).toBe('接口核对：下次核对日期：2026-09-25 → 2026-09-28；关联需求已调整');
  expect(auditSummary(JSON.stringify({reason:'修正历史记录',before:{title:'接口核对',nextReviewAt:'2026-09-28'},after:{title:'接口核对',nextReviewAt:null}}))).toBe('接口核对：下次核对日期：2026-09-28 → 未设置');
  for (const action of ['创建需求', '创建需求并生成工作项']) {
    expect(auditSummary(`${action}：资料核对；${JSON.stringify({featureId:'f',phaseId:'p',reason:' 补充上线索引；在目标日期前完成。 '})}`))
      .toBe(`${action}：资料核对；安排原因：补充上线索引；在目标日期前完成。`);
  }
});

it('对象链接只使用审计身份并显式指定项目与清单范围', () => {
  for(const [entityType,prefix] of [['requirement',''],['work_item',''],['feature','feature:'],['feature_phase','phase:']]){
    const url=new URL(auditObjectUrl({entityType,entityId:'工作 & #1',projectId:'项目 & #1'})!,'http://localhost');
    expect(url.searchParams.get('detailId')).toBe(prefix+'工作 & #1');
    expect(url.searchParams.get('projectId')).toBe('项目 & #1');expect(url.searchParams.get('scopeType')).toBe('project');expect(url.searchParams.get('workspaceView')).toBe('list');
  }
  expect(auditObjectUrl({entityType:'work_item',entityId:'work',projectId:null})).toBeUndefined();
  expect(auditObjectUrl({entityType:'backup',entityId:'file',projectId:'p'})).toBeUndefined();
  const issueUrl=new URL(auditObjectUrl({entityType:'issue',entityId:'issue & #1',projectId:'project & #1'})!,'http://localhost');
  expect(issueUrl.pathname).toBe('/issues');expect(issueUrl.searchParams.get('detailId')).toBe('issue & #1');expect(issueUrl.searchParams.get('projectId')).toBe('project & #1');expect(issueUrl.searchParams.get('detailTab')).toBe('basic');
});

it('带前后快照的特性日志显示实际改变的业务资料与评估', () => {
  const before={id:'f',name:'使用说明',description:'上线说明',version:2,overview:{expectation:'',progressSummary:'',assessment:'pending',note:''}};
  const after={...before,version:3,overview:{expectation:'覆盖版本差异',progressSummary:'核验一半',assessment:'off_track',note:'仍缺使用限制'}};
  const original='修改特性；修改前：'+JSON.stringify(before)+'；修改后：'+JSON.stringify(after);
  const result=auditSummary(original);
  expect(result).toBe('修改特性：使用说明；判断：待评估 → 有偏差；大致预期：未填写 → 覆盖版本差异；进展简述：未填写 → 核验一半；原因或变化说明：未填写 → 仍缺使用限制');
  expect(result).not.toContain('version');expect(result).not.toContain('上线说明');
  expect(auditSummary('修改特性；修改前：'+JSON.stringify(after)+'；修改后：'+JSON.stringify({...after,overview:{...after.overview,note:''}}))).toContain('原因或变化说明：仍缺使用限制 → 未填写');
});

it('同一文本快照机制保留特性生命周期、规划说明和归属调整原因', () => {
  const feature={name:'上线资料',description:'核对交付',archivedAt:null};
  const record=(action:string,before:unknown,after:unknown,reason='')=>action+'；修改前：'+JSON.stringify(before)+'；修改后：'+JSON.stringify(after)+(reason?'；原因：'+reason:'');
  expect(auditSummary(record('修改特性',null,feature))).toBe('创建特性：上线资料；说明：核对交付');
  expect(auditSummary(record('修改特性',feature,null))).toBe('删除特性：上线资料');
  expect(auditSummary(record('修改特性',feature,{...feature,name:'交付资料',archivedAt:'2026-09-25'}))).toBe('修改特性：交付资料；名称：上线资料 → 交付资料；特性已归档');
  expect(auditSummary(record('规划关系',{note:'旧说明'},{note:'新说明'}))).toBe('修改规划关系；关系说明：旧说明 → 新说明');
  expect(auditSummary(record('移除规划关系',{note:'原说明'},null))).toBe('移除规划关系；原关系说明：原说明');
  expect(auditSummary(record('调整特性归属',{featureId:'f1',phaseId:'p1'},{featureId:'f2',phaseId:null},'移入上线资料，保持已完成进展'))).toBe('调整特性归属；所属特性已调整；所属Phase已调整；移入上线资料，保持已完成进展');
  expect(auditSummary('导入调整归属：'+JSON.stringify({before:{featureId:'f1',phaseId:null},after:{featureId:'f1',phaseId:'p1'},reason:'补充上线索引'}))).toBe('导入调整归属；所属Phase已调整；安排原因：补充上线索引');
  expect(auditSummary('导入调整归属：'+JSON.stringify({title:'索引复核',before:{featureId:'f1',featureName:'使用说明',phaseId:'p1',phaseName:'试点'},after:{featureId:'f2',featureName:'发布资料',phaseId:null,phaseName:null},reason:'整理同批材料'}))).toBe('导入调整归属：索引复核；所属特性：使用说明 → 发布资料；所属Phase：试点 → 未设置；安排原因：整理同批材料');
  expect(auditSummary('导入需求：0 个新需求')).toBe('导入需求：新增 0 个；更新数量未记录');
  expect(auditSummary('导入需求：2 个新需求')).toBe('导入需求：新增 2 个；更新数量未记录');
  expect(auditSummary('导入需求：新增 0 个，更新 1 个，新增工作项 0 个')).toBe('导入需求：新增 0 个，更新 1 个，新增工作项 0 个');
});

it('不能完整识别的文字快照保留原文，不误读自由文本或嵌入的分隔符', () => {
  for(const original of ['修改特性；修改前：{坏数据}；修改后：null','修改特性；修改前：[]；修改后：{}','其他操作；修改前：null；修改后：{"name":"资料"}',
    '创建需求：资料；{坏数据}', '创建需求：资料；{"phaseId":"p"}', '创建需求：资料；{"reason":" "}',
    '创建需求：资料；{"reason":"说明","unknown":"保留"}', '创建需求：标题含；{分隔符}；{"reason":"说明"}',
    '导入调整归属：{坏数据}', '导入调整归属：{"before":{},"after":{}}',
    '导入调整归属：{"before":{"featureId":null,"phaseId":null},"after":{"featureId":"f","phaseId":null},"unknown":"保留"}',
    '导入调整归属：{"before":{"featureId":null,"phaseId":null},"after":{"featureId":"f","phaseId":null},"reason":1}',
    '修改特性；修改前：null；修改后：{"name":"包含；原因：符号"}',
    '修改特性；修改前：{"name":"包含；修改后：符号"}；修改后：{"name":"新值"}'])expect(auditSummary(original)).toBe(original);
});
