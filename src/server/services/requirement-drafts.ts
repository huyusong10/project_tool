import {createHash,randomUUID} from 'node:crypto';
import {sqlite} from '../database';
import type {Actor} from '../auth';
import {assertProjectReadable,assertProjectManager,canReadProject,canManageProject,requireAuthorizationActor} from '../authorization';
import {fail,forbidden,notFound} from '../errors';
import {createDraftInput,updateDraftInput,listDraftInput,closeDraftInput,draftVersionInput,publishDraftInput,templateDraftInput,requirementDraftContent,type DraftContent,type RequirementDraft,type DraftPreview,type DraftReceipt,type DraftSummary} from '../../shared/requirement-drafts';
import type {DependencyChangesInput,EditorEntityChange} from '../../shared/path-contracts';
import {previewPersonalDraftChanges,previewDependencyChanges,applyDependencyChanges} from './path-changes';
import {readIntakeCatalog,intakeRevision,persistDocuments,persistOrganization,persistLink} from './intake-metadata';
import {loadPathInput} from './paths';
import {listTemplates} from '../services';
import {recordAudit} from './audit';
import {todayIso} from '../../shared/domain';
import {sourceDocumentInput} from '../../shared/intake';
import {assertEditorAssignees} from './editor-entities';

type Row={id:string;account_id:string;project_id:string;title:string;content:string;version:number;status:RequirementDraft['status'];source:RequirementDraft['source'];receipt:string|null;created_at:string;updated_at:string};
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sourceKey=(document:string,clause:string)=>JSON.stringify([document,clause]);
function owned(id:string,actor:Actor){
  const auth=requireAuthorizationActor(actor);
  const row=sqlite.prepare('SELECT * FROM requirement_drafts WHERE id=? AND account_id=?').get(id,auth.accountId) as Row|undefined;
  if(!row)notFound('个人草稿不存在');
  return row;
}
function value(row:Row,actor:Actor):RequirementDraft{
  const auth=requireAuthorizationActor(actor);
  return {id:row.id,accountId:row.account_id,projectId:row.project_id,title:row.title,content:JSON.parse(row.content),version:row.version,status:row.status,source:row.source,createdAt:row.created_at,updatedAt:row.updated_at,projectAccessible:canReadProject(auth,row.project_id),canPublish:actor.type==='user'&&canManageProject(auth,row.project_id),receipt:row.receipt?JSON.parse(row.receipt):null};
}
function editable(row:Row,version:number){
  if(row.status!=='draft')fail('已发布或已关闭草稿只读','TERMINAL_LOCKED');
  if(row.version!==version)fail('草稿已被其他窗口或 Agent 更新，请对比后保存','STALE_WRITE',409,{draftId:row.id},row.version);
}
function requestResult(accountId:string,requestId:string,kind:string,content:unknown){
  const row=sqlite.prepare('SELECT kind,content_hash,result FROM requirement_draft_requests WHERE account_id=? AND request_id=?').get(accountId,requestId) as {kind:string;content_hash:string;result:string}|undefined;
  if(!row)return null;
  if(row.kind!==kind||row.content_hash!==hash(content))fail('请求标识已用于其他内容','STALE_WRITE');
  return JSON.parse(row.result) as {draftId:string;version:number};
}
function remember(row:Row,requestId:string,kind:string,content:unknown){
  sqlite.prepare('INSERT INTO requirement_draft_requests(account_id,request_id,draft_id,kind,content_hash,result,created_at) VALUES(?,?,?,?,?,?,?)').run(row.account_id,requestId,row.id,kind,hash(content),JSON.stringify({draftId:row.id,version:row.version}),new Date().toISOString());
}

/** Reject structural mistakes and foreign references even when business fields are unfinished. */
function checkStructure(projectId:string,content:DraftContent,actor:Actor){
  assertProjectReadable(requireAuthorizationActor(actor),projectId);
  const formal=loadPathInput(projectId),catalog=readIntakeCatalog(projectId,actor);
  const ids=new Set<string>();
  const all=new Map<string,{entity:string;requirementId?:string|null}>();
  for(const r of formal.requirements.filter(r=>!r.deletedAt))all.set(r.id,{entity:'requirement'});
  for(const w of formal.workItems)if(all.has(w.requirementId))all.set(w.id,{entity:'work',requirementId:w.requirementId});
  for(const m of formal.milestones||[])if(!m.cancelled)all.set(m.id,{entity:'milestone',requirementId:m.requirementId});
  for(const e of content.entities){
    assertEditorAssignees(projectId,[e.data.ownerId,e.data.acceptanceOwnerId,...e.data.assigneeIds||[]]);
    if(ids.has(e.id))fail('新增对象标识重复：'+e.id);ids.add(e.id);
    for(const table of ['requirements','work_items','milestones'])if(sqlite.prepare('SELECT 1 FROM '+table+' WHERE id=?').get(e.id))fail('新增标识已存在，请使用只读引用：'+e.id);
    if(e.entity==='requirement'&&e.requirementId)fail('需求不能再包含上层需求');
    const allowed=e.entity==='requirement'?['title','ownerId','acceptanceOwnerId','priority','background','acceptanceCriteria','deliveryScope','tags','plannedStart','plannedEnd','durationDays']:e.entity==='work'?['title','ownerId','assigneeIds','plannedStart','plannedEnd','durationDays','arrangement','arrangementAnchor']:['title','targetDate','confirmationMode'];
    if(Object.keys(e.data).some(k=>!allowed.includes(k)))fail(e.entity+' 包含不支持的字段');
    if(e.entity!=='requirement'&&e.group)fail('只有需求可设置分组');
    all.set(e.id,{entity:e.entity,requirementId:e.requirementId});
  }
  const requireRef=(id:string,kind?:string)=>{const r=all.get(id);if(!r||kind&&r.entity!==kind)fail('引用不属于当前项目或已删除：'+id);return r;};
  for(const e of content.entities){
    if(e.entity==='work'&&!e.requirementId)fail('工作项必须属于一个新需求');
    if(e.requirementId){requireRef(e.requirementId,'requirement');if(!ids.has(e.requirementId))fail('首版不能向已有需求新增工作或里程碑');}
    if(e.data.arrangementAnchor){const anchor=e.data.arrangementAnchor.replace(/^(start|acceptance|execute):/,'');if(anchor!=='project')requireRef(anchor);}
  }
  for(const r of content.references)requireRef(r.id,r.entity);
  const endpoint=(req:string,work:string|null|undefined,milestone:string|null|undefined)=>{
    if(work&&milestone)fail('依赖不能同时指向工作项和里程碑');
    if(milestone){const m=requireRef(milestone,'milestone');if((m.requirementId||'')!==req)fail('里程碑归属与端点不一致');}
    else {requireRef(req,'requirement');if(work&&requireRef(work,'work').requirementId!==req)fail('工作项归属与端点不一致');}
  };
  const edgeIds=new Set<string>();
  for(const e of content.dependencies){if(ids.has(e.clientId)||edgeIds.has(e.clientId))fail('依赖标识重复');edgeIds.add(e.clientId);endpoint(e.sourceRequirementId,e.sourceWorkItemId,e.sourceMilestoneId);endpoint(e.targetRequirementId,e.targetWorkItemId,e.targetMilestoneId);}
  const sources=new Set(catalog.documents.flatMap(d=>d.clauses.map(c=>sourceKey(d.key,c.key))));
  const documentIds=new Set<string>();
  for(const d of content.documents){
    if(documentIds.has(d.key))fail('来源文档标识重复');documentIds.add(d.key);const clauseIds=new Set<string>();
    for(const c of d.clauses){if(clauseIds.has(c.key))fail('条款标识重复；原编号可以重复');clauseIds.add(c.key);sources.add(sourceKey(d.key,c.key));}
  }
  const links=new Set<string>();
  for(const l of content.links){endpoint(l.requirementId,l.workItemId,null);if(!sources.has(sourceKey(l.document,l.clause)))fail('关联条款不存在');const k=JSON.stringify([l.requirementId,l.workItemId||'',l.document,l.clause]);if(links.has(k))fail('来源关联重复');links.add(k);}
  for(const t of content.templates){if(!ids.has(t.requirementId)||all.get(t.requirementId)?.entity!=='requirement')fail('工作流快照必须属于新需求');if(!sqlite.prepare('SELECT 1 FROM work_item_templates WHERE id=? AND project_id=?').get(t.templateId,projectId))fail('模板引用不属于当前项目');}
  return {formal,catalog};
}

export function getRequirementDraft(id:string,actor:Actor){return value(owned(id,actor),actor);}
export function listRequirementDrafts(raw:unknown,actor:Actor){
  const input=listDraftInput.parse(raw),auth=requireAuthorizationActor(actor),args:unknown[]=[auth.accountId],conditions=['account_id=?'];
  if(input.projectId){conditions.push('project_id=?');args.push(input.projectId);}
  if(input.status){conditions.push('status=?');args.push(input.status);}
  if(input.q){conditions.push('instr(lower(title),lower(?))>0');args.push(input.q);}
  const where=conditions.join(' AND '),total=(sqlite.prepare('SELECT count(*) AS n FROM requirement_drafts WHERE '+where).get(...args) as {n:number}).n;
  const rows=sqlite.prepare('SELECT * FROM requirement_drafts WHERE '+where+' ORDER BY updated_at DESC,id LIMIT ? OFFSET ?').all(...args,input.pageSize,(input.page-1)*input.pageSize) as Row[];
  const items:DraftSummary[]=rows.map(row=>{const {content,receipt:_receipt,...r}=value(row,actor);return {...r,requirementCount:content.entities.filter(e=>e.entity==='requirement').length,workItemCount:content.entities.filter(e=>e.entity==='work').length};});
  return {items,total,page:input.page,pageSize:input.pageSize,revision:hash(rows.map(r=>[r.id,r.version]))};
}
export function createRequirementDraft(raw:unknown,actor:Actor){
  const input=createDraftInput.parse(raw),auth=requireAuthorizationActor(actor);
  return sqlite.transaction(()=>{
    const prior=requestResult(auth.accountId,input.requestId,'create',input);if(prior)return getRequirementDraft(prior.draftId,actor);
    checkStructure(input.projectId,input.content,actor);
    const id=randomUUID(),now=new Date().toISOString();
    sqlite.prepare('INSERT INTO requirement_drafts(id,account_id,project_id,title,content,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,auth.accountId,input.projectId,input.title,JSON.stringify(input.content),actor.type==='token'?'mcp':'web',now,now);
    const row=owned(id,actor);remember(row,input.requestId,'create',input);return value(row,actor);
  }).immediate();
}
export function updateRequirementDraft(id:string,raw:unknown,actor:Actor){
  const input=updateDraftInput.parse(raw);
  return sqlite.transaction(()=>{
    const row=owned(id,actor),prior=requestResult(row.account_id,input.requestId,'update',{id,...input});
    if(prior)return getRequirementDraft(prior.draftId,actor);
    editable(row,input.expectedVersion);checkStructure(row.project_id,input.content,actor);
    sqlite.prepare('UPDATE requirement_drafts SET title=?,content=?,version=version+1,updated_at=? WHERE id=?').run(input.title,JSON.stringify(input.content),new Date().toISOString(),id);
    const updated=owned(id,actor);remember(updated,input.requestId,'update',{id,...input});return value(updated,actor);
  }).immediate();
}
export function closeRequirementDraft(id:string,raw:unknown,actor:Actor){
  const input=closeDraftInput.parse(raw);
  return sqlite.transaction(()=>{const row=owned(id,actor),prior=requestResult(row.account_id,input.requestId,'close',{id,...input});if(prior)return getRequirementDraft(id,actor);editable(row,input.expectedVersion);
    sqlite.prepare("UPDATE requirement_drafts SET status='closed',version=version+1,updated_at=? WHERE id=?").run(new Date().toISOString(),id);
    const updated=owned(id,actor);remember(updated,input.requestId,'close',{id,...input});return value(updated,actor);
  }).immediate();
}

function compile(content:DraftContent,revision:number):DependencyChangesInput{
  const entities:EditorEntityChange[]=content.entities.map(e=>{
    const data={...e.data};
    if(e.entity==='requirement'){
      const decomposed=content.entities.some(w=>w.entity==='work'&&w.requirementId===e.id);
      if(decomposed){delete data.plannedStart;delete data.plannedEnd;delete data.durationDays;}
      return {entity:e.entity,op:'create',id:e.id,data:{...data,executionMode:decomposed?'work_items':'direct',deliveryScope:data.deliveryScope||'candidate',durationDays:decomposed?undefined:data.durationDays??null}};
    }
    return {entity:e.entity,op:'create',id:e.id,requirementId:e.requirementId,data:e.entity==='work'?{...data,durationDays:data.durationDays??null}:data};
  });
  return {expectedRevision:revision,target:'project',changes:{entities,add:content.dependencies,remove:[],estimates:[]}};
}
function prepare(row:Row,actor:Actor){
  const content=requirementDraftContent.parse(JSON.parse(row.content)),{catalog}=checkStructure(row.project_id,content,actor);
  const errors:string[]=[],warnings:string[]=[],sourceChanges:NonNullable<DraftPreview['sourceChanges']>=[];
  if(!row.title.trim())errors.push('请填写草稿标题');
  if(!content.entities.length&&!content.documents.length&&!content.links.length&&!content.dependencies.length)errors.push('草稿尚无可发布内容');
  for(const e of content.entities){
    if(!e.data.title.trim())errors.push(e.id+'：请填写标题');
    if(e.entity==='requirement'&&!e.data.acceptanceCriteria?.trim())errors.push(e.data.title+'：请填写可验证的验收条件');
    if(e.entity!=='milestone'&&!e.data.ownerId)warnings.push(e.data.title+'：负责人待人类确定');
    if(e.entity==='work'||e.entity==='requirement'&&!content.entities.some(w=>w.entity==='work'&&w.requirementId===e.id)){
      if(!e.data.durationDays&&!e.data.plannedEnd)warnings.push(e.data.title+'：工期未知');
      if(!e.data.plannedStart||!e.data.plannedEnd)warnings.push(e.data.title+'：完整排期待确定');
    }
  }
  for(const d of content.documents){
    if(!d.title)errors.push('来源文档缺少标题');
    if(!d.complete)warnings.push(d.title+'：仅统计选摘条款，不代表全文完成率');
    if(!d.url||!d.version)warnings.push(d.title+'：原始地址或版本未提供，保留正文与内部修订标识');
    const numbers=new Set<string>();
    for(const c of d.clauses){
      if(!c.title)errors.push(d.title+' / '+c.key+'：条款标题未填写');
      if(c.externalId&&numbers.has(c.externalId))warnings.push('重复原编号：'+c.externalId+'（按稳定标识区分）');numbers.add(c.externalId);
      const old=catalog.documents.find(v=>v.key===d.key)?.clauses.find(v=>v.key===c.key);
      if(old&&(['section','externalId','title','content','priority'] as const).some(k=>old.current[k]!==c[k])){
        warnings.push(d.title+' / '+c.title+'：来源变更，将保留原版本并标记已有落实范围待核对');
        sourceChanges.push({title:d.title+' / '+c.title,before:[old.current.documentVersion,old.current.section,old.current.externalId,old.current.title,old.current.content,old.current.priority].join('\n'),after:[d.version,d.clauses.find(v=>v.key===c.key)!.section,c.externalId,c.title,c.content,c.priority].join('\n')});
      }
      if(old?.links.length&&content.links.some(l=>l.document===d.key&&l.clause===c.key&&content.entities.some(e=>e.entity==='requirement'&&e.id===l.requirementId)))warnings.push(c.title+'：来源已有交付 '+old.links.map(l=>l.requirementTitle).join('、')+'，请核对是否应引用已有成果');
      if(!content.links.some(l=>l.document===d.key&&l.clause===c.key)&&!c.deferredReason&&!old?.links.length)warnings.push(c.title+'：尚未关联需求或说明暂缓原因');
    }
  }
  for(const l of content.links){
    if(!l.scope.trim())errors.push('请填写来源落实范围');
    const r=sqlite.prepare('SELECT status FROM requirements WHERE id=? AND project_id=?').get(l.requirementId,row.project_id) as {status:string}|undefined;
    if(r&&['completed','cancelled'].includes(r.status)&&!l.reason?.trim())errors.push('已结束需求调整来源必须填写纠错原因');
  }
  const templates=listTemplates(row.project_id);
  for(const t of content.templates){const live=templates.find(v=>v.id===t.templateId);if(!live||live.updatedAt!==t.version)warnings.push(t.name+'：模板已变化，使用本草稿中保留的展开结果；请核对人工修改');}
  const changes=compile(content,Number(catalog.revision));let core:DraftPreview['core']=null;
  if(changes.changes.entities?.length||changes.changes.add.length){
    try{core=previewPersonalDraftChanges(row.project_id,changes,actor);}catch(error){errors.push(error instanceof Error?error.message:'无法分析执行网络');}
  }
  const preview:DraftPreview={draftVersion:row.version,projectRevision:Number(catalog.revision),previewToken:hash({id:row.id,version:row.version,content,revision:catalog.revision,templates:templates.map(t=>[t.id,t.updatedAt]),date:todayIso()}),errors:[...new Set(errors)],warnings:[...new Set([...warnings,...content.questions.map(q=>'待确认：'+q)])],sourceChanges,core};
  return {preview,changes,content};
}
export function previewRequirementDraft(id:string,raw:unknown,actor:Actor){const input=draftVersionInput.parse(raw);return sqlite.transaction(()=>{const row=owned(id,actor);editable(row,input.expectedVersion);return prepare(row,actor).preview;})();}
export function previewRequirementDraftPlan(id:string,raw:unknown,actor:Actor){
  const input=draftVersionInput.parse(raw);
  return sqlite.transaction(()=>{
    const row=owned(id,actor);editable(row,input.expectedVersion);
    const prepared=prepare(row,actor),changes=structuredClone(prepared.changes);
    for(const e of changes.changes.entities||[])if(e.entity==='requirement')e.data.deliveryScope='committed';
    let core:DraftPreview['core']=null;
    try{if(changes.changes.entities?.length||changes.changes.add.length)core=previewPersonalDraftChanges(row.project_id,changes,actor);}catch(error){prepared.preview.errors.push((error as Error).message);}
    return {...prepared.preview,core,warnings:['此计划假设当前草稿全部纳入交付，用完整正式项目与本草稿计算；其他草稿不参与。',...prepared.preview.warnings]};
  })();
}
export function getRequirementDraftContext(id:string,actor:Actor){const row=owned(id,actor);assertProjectReadable(requireAuthorizationActor(actor),row.project_id);return {project:loadPathInput(row.project_id),catalog:readIntakeCatalog(row.project_id,actor),templates:listTemplates(row.project_id),people:sqlite.prepare("SELECT p.id,p.name FROM project_people pp JOIN people p ON p.id=pp.person_id JOIN accounts a ON a.person_id=p.id WHERE pp.project_id=? AND pp.project_role IN ('member','manager') AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL ORDER BY p.name").all(row.project_id)};}
export function previewRequirementDraftTemplate(id:string,raw:unknown,actor:Actor){
  const input=templateDraftInput.parse(raw);
  return sqlite.transaction(()=>{
    const row=owned(id,actor);editable(row,input.expectedVersion);assertProjectReadable(requireAuthorizationActor(actor),row.project_id);
    const content:DraftContent=JSON.parse(row.content),requirement=content.entities.find(e=>e.id===input.requirementId&&e.entity==='requirement');
    if(!requirement)fail('工作流只能展开到当前草稿中的新需求');
    const template=listTemplates(row.project_id).find(t=>t.id===input.templateId);if(!template)fail('流程不属于当前项目或已停用');
    const changes:DependencyChangesInput={expectedRevision:Number(intakeRevision(row.project_id)),target:'project',changes:{add:[],remove:[],estimates:[],entities:[{entity:'requirement',op:'create',id:requirement.id,data:{title:requirement.data.title||'未命名需求',executionMode:'work_items',deliveryScope:'candidate',templateId:template.id,plannedStart:input.plannedStart}}]}};
    const result=previewPersonalDraftChanges(row.project_id,changes,actor),instance=result.templateInstances[0];
    if(!instance)fail('工作流没有可展开内容');
    return {draftVersion:row.version,template:{requirementId:requirement.id,templateId:template.id,name:template.name,version:template.updatedAt,expandedEntityIds:instance.entities.map(e=>e.id),expandedDependencyIds:instance.dependencies.map(e=>e.id)},entities:instance.entities.map(({op:_op,...e})=>e),dependencies:instance.dependencies.map(e=>({clientId:e.id,sourceRequirementId:e.sourceRequirementId,sourceWorkItemId:e.sourceWorkItemId,targetRequirementId:e.targetRequirementId,targetWorkItemId:e.targetWorkItemId,sourceMilestoneId:e.sourceMilestoneId,targetMilestoneId:e.targetMilestoneId}))};
  })();
}
export function getRequirementDraftPublishReceipt(id:string,batchId:string,actor:Actor):DraftReceipt|{status:'not_found'}{
  const row=owned(id,actor),receipt:DraftReceipt|null=row.receipt?JSON.parse(row.receipt):null;
  return receipt?.batchId===batchId?receipt:{status:'not_found'};
}
export function publishRequirementDraft(id:string,raw:unknown,actor:Actor):DraftReceipt{
  const input=publishDraftInput.parse(raw);
  return sqlite.transaction(()=>{
    const row=owned(id,actor),auth=requireAuthorizationActor(actor);
    if(actor.type!=='user')forbidden('请本人登录网页审核并发布草稿');
    assertProjectManager(auth,row.project_id);
    const prior=requestResult(row.account_id,input.batchId,'publish',{id,...input});
    if(prior){const receipt=getRequirementDraftPublishReceipt(id,input.batchId,actor);if(receipt.status==='applied')return receipt;fail('发布回执不完整');}
    editable(row,input.expectedVersion);
    const {preview,changes,content}=prepare(row,actor);
    if(preview.projectRevision!==input.projectRevision||preview.previewToken!==input.previewToken)fail('项目、模板或草稿已变化，请重新预览；已填内容保留','STALE_WRITE');
    if(preview.errors.length)fail(preview.errors.join('；'));
    // Core writes retain all normal permission and business checks, under this outer transaction.
    const ids:Record<string,string>={};
    if(changes.changes.entities?.length||changes.changes.add.length){const core=previewDependencyChanges(row.project_id,changes,actor);Object.assign(ids,applyDependencyChanges(row.project_id,{...changes,batchId:randomUUID(),previewToken:core.previewToken},actor).addedIds);}
    persistDocuments(row.project_id,content.documents.map(d=>sourceDocumentInput.parse({...d,url:d.url,version:d.version})));
    const now=new Date().toISOString();
    for(const e of content.entities.filter(e=>e.entity==='requirement')){
      let groupId:string|null=null;
      if(e.group){const old=sqlite.prepare('SELECT id FROM requirement_groups WHERE project_id=? AND name=?').get(row.project_id,e.group) as {id:string}|undefined;groupId=old?.id||randomUUID();if(!old)sqlite.prepare('INSERT INTO requirement_groups(id,project_id,name,sort_order,created_at,updated_at) VALUES(?,?,?,(SELECT count(*) FROM requirement_groups WHERE project_id=?),?,?)').run(groupId,row.project_id,e.group,row.project_id,now,now);ids['group:'+e.group]=groupId;}
      persistOrganization(ids[e.id],row.project_id,{groupId,tags:e.data.tags||[]});
    }
    for(const d of content.documents){const doc=sqlite.prepare('SELECT id FROM source_documents WHERE project_id=? AND source_key=?').get(row.project_id,d.key) as {id:string};ids['document:'+d.key]=doc.id;for(const c of d.clauses){const clause=sqlite.prepare('SELECT id FROM source_clauses WHERE document_id=? AND source_key=?').get(doc.id,c.key) as {id:string};ids['clause:'+sourceKey(d.key,c.key)]=clause.id;}}
    for(const l of content.links){
      const clause=sqlite.prepare('SELECT c.id,c.current_revision_id AS revision FROM source_clauses c JOIN source_documents d ON d.id=c.document_id WHERE d.project_id=? AND d.source_key=? AND c.source_key=?').get(row.project_id,l.document,l.clause) as {id:string;revision:string};
      const req=ids[l.requirementId]||l.requirementId,work=l.workItemId?(ids[l.workItemId]||l.workItemId):null;
      persistLink(req,work,clause.id,l.scope,clause.revision);
      sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(now,req);
      recordAudit(actor,'update','requirement',req,'发布草稿来源关联'+(l.reason?'；纠错：'+l.reason:''));
    }
    recordAudit(actor,'publish_requirement_draft','project',row.project_id,'本人发布个人需求草稿：'+row.title);
    const receipt:DraftReceipt={status:'applied',batchId:input.batchId,draftId:id,draftVersion:row.version,projectId:row.project_id,projectRevision:Number(intakeRevision(row.project_id)),ids,createdAt:now};
    sqlite.prepare("UPDATE requirement_drafts SET status='published',receipt=?,version=version+1,updated_at=? WHERE id=?").run(JSON.stringify(receipt),now,id);
    remember(owned(id,actor),input.batchId,'publish',{id,...input});
    return receipt;
  }).immediate();
}
