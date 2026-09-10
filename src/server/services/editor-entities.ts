import {validateCoordination,isCoordinationEdit,assertCoordinationAccess} from './blocker-coordination';
import {refreshPathAssignments} from './path-assignments';
import {templateInstanceKey,type DraftTemplateInstance} from '../../shared/template-instance';
import {coordinationKeys} from '../../shared/blocker-coordination';
import {validateDeliveryFields,updateDeliveryRequirement} from './delivery-execution';
import {sqlite} from '../database';
import type {Actor} from '../auth';
import {assertProjectManager,assertRequirementOwnerOrManager,requireAuthorizationActor} from '../authorization';
import {fail,notFound} from '../errors';
import {requireLabel,normalizeRequirementText} from './support';
import {createRequirementInputSchema,updateRequirementInputSchema,createWorkItemInputSchema,updateWorkItemInputSchema} from '../../shared/contracts';
import {addBusinessDays,businessDaysInclusive,plannedDatesFromOffset,plannedStartFromDeadline,canDeleteWorkItem,deriveRequirementMetrics} from '../../shared/domain';
import {remapPathNodeId,type PathInput,type PathRequirement} from '../../shared/paths';
import type {EditorEntityChange,DependencyChanges} from '../../shared/path-contracts';
import {createRequirement,updateRequirement,archiveRequirement,createWorkItem,updateWorkItem,deleteWorkItem,listTemplates} from '../services';

const workDefaults={status:'not_started',progress:0,plannedStart:null,plannedEnd:null,actualStart:null,actualEnd:null,durationDays:1,earliestStart:null,unblockEstimate:null,forecastEnd:null,forecastDuration:null,forecastReadyAt:null,blockedAt:null,blockedReason:null,milestoneLabel:null,ownerName:null};
const entityTable={requirement:'requirements',work:'work_items',milestone:'milestones'};
type TemplateExpansion=DraftTemplateInstance & {version:string;items:Array<{clientId:string;templateItemId:string;kind:string}>};
export function assertEditorAssignees(projectId:string,ids:Array<string|null|undefined>){
  for(const id of new Set(ids.filter(Boolean)))if(!sqlite.prepare("SELECT 1 FROM project_people pp JOIN people p ON p.id=pp.person_id WHERE pp.project_id=? AND pp.person_id=? AND pp.project_role IN ('member','manager') AND p.active=1 AND p.deleted_at IS NULL").get(projectId,id))fail('负责人必须是当前项目中已启用的成员或项目经理');
}
export function prepareEditorEntities(snapshot:PathInput,changes:EditorEntityChange[],actor:Actor){
  const current=requireAuthorizationActor(actor),created=new Set(changes.filter(c=>c.op==='create').map(c=>c.id));
  if(new Set(changes.map(c=>c.id)).size!==changes.length)fail('同一对象不能在批次中重复提交');
  snapshot.milestones||=[];
  const expanded=new Map<string,TemplateExpansion>();
  for(const c of [...changes].sort((a,b)=>Number(b.entity==='requirement')-Number(a.entity==='requirement'))){
    if(c.data.reviewForecast&&c.entity!=='requirement')fail('工作项预测核对请通过估算修改提交');
    const table=entityTable[c.entity],generated=expanded.get(c.requirementId||'')?.items.find(e=>e.clientId===c.id&&e.kind===c.entity);
    const stored=sqlite.prepare('SELECT * FROM '+table+' WHERE id=?').get(c.id) as Record<string,unknown>|undefined;
    const row=stored||(generated?{id:c.id,requirement_id:c.requirementId,project_id:snapshot.projectId,version:1}:undefined);
    if(c.op==='create'&&row)fail('新增对象标识已存在');
    if(c.op!=='create'&&(!row||row.version!==(c.expectedVersion??(generated?1:undefined))))fail('对象版本已变化，请核对草稿','STALE_WRITE',409,{entityIds:[c.id]});
    if(row&&c.entity!=='requirement'&&c.requirementId!==undefined&&(c.requirementId||null)!==(row.requirement_id||null))fail('不能更改对象归属');
    const requirementId=c.entity==='requirement'?c.id:c.requirementId||String(row?.requirement_id||'');
    const req=snapshot.requirements.find(r=>r.id===requirementId);
    if(c.entity==='requirement'&&c.op==='create'||!requirementId||created.has(requirementId))assertProjectManager(current,snapshot.projectId);
    else {if(!req||req.deletedAt)notFound('需求不存在');if(c.entity!=='milestone'&&c.op==='update'&&isCoordinationEdit(c.data))assertCoordinationAccess(c.entity,c.id,c.data,actor);else assertRequirementOwnerOrManager(current,requirementId);}
    if(c.entity==='milestone'&&row?.project_id!==undefined&&row.project_id!==snapshot.projectId)notFound('里程碑不属于当前项目');
    if(req&&['completed','cancelled'].includes(req.status)&&c.op!=='delete')fail('已结束需求不能修改结构','TERMINAL_LOCKED');
    if(c.entity!=='requirement'&&req?.status==='pending_acceptance')fail('待验收需求不能修改结构','TERMINAL_LOCKED');
    if(c.data.title!==undefined)c.data.title=requireLabel(c.data.title,'名称');
    assertEditorAssignees(snapshot.projectId,[c.data.ownerId,...c.data.assigneeIds||[]]);
    for(const key of ['plannedStart','plannedEnd','targetDate'] as const)if(c.data[key]&&businessDaysInclusive(c.data[key]!,c.data[key]!)!==1)fail('排期日期必须是工作日');
    if(c.data.plannedStart&&c.data.plannedEnd&&c.data.plannedStart>c.data.plannedEnd)fail('计划完成日期不能早于计划开始日期');
    if(coordinationKeys.some(k=>c.data[k]!==undefined)){const original=c.entity==='requirement'?req:snapshot.workItems.find(w=>w.id===c.id);if(c.op!=='update'||!original||original.status!=='blocked')fail('只有阻塞对象可以修改协调信息');const normalized=validateCoordination(snapshot.projectId,{...original,...c.data});for(const key of coordinationKeys)if(c.data[key]!==undefined||c.data.blockedIssueId)c.data[key]=normalized[key];}
    if(c.entity==='requirement'){
      if(c.op==='create'){
        const {reason:_creationReason,...creation}=c.data;
        const value=normalizeRequirementText(createRequirementInputSchema.parse({...creation,projectId:snapshot.projectId,templateId:c.data.templateId||undefined}));
        let template=value.templateId?listTemplates(snapshot.projectId).find(t=>t.id===value.templateId):undefined;
        if(value.templateId&&!template)fail('请选择当前项目的有效流程设计');
        if(value.executionMode!=='direct'&&(value.plannedStart||value.plannedEnd)&&!template){const project=sqlite.prepare('SELECT default_template_id AS id FROM projects WHERE id=?').get(snapshot.projectId) as {id:string|null};template=listTemplates(snapshot.projectId).find(t=>t.id===project.id)||listTemplates(snapshot.projectId)[0];}
        if(value.executionMode!=='direct'&&(value.plannedStart||value.plannedEnd)&&!template)fail('立即规划时请选择有效流程');
        validateDeliveryFields(snapshot.projectId,value,actor);
        const base=value.plannedStart||(value.plannedEnd&&template?plannedStartFromDeadline(value.plannedEnd,template.items.filter((i:{kind?:string})=>i.kind!=='milestone')):null);
        const r:PathRequirement={...value,id:c.id,projectId:snapshot.projectId,status:'planning',ownerName:null,plannedStart:base||null,plannedEnd:null,acceptedAt:null,dependenciesReviewedAt:new Date().toISOString(),scheduleAnchor:base||null,forecastAcceptance:null,deletedAt:null,version:1};
        if(value.executionMode==='direct'){
          if(value.templateId)fail('直接执行不能同时使用流程');
          r.status='not_started';r.plannedEnd=value.plannedEnd||null;r.executionMode='direct';r.progress=0;
          if(value.durationDays){if(r.plannedStart)r.plannedEnd=addBusinessDays(r.plannedStart,value.durationDays-1);else if(r.plannedEnd)r.plannedStart=addBusinessDays(r.plannedEnd,1-value.durationDays);}
          r.scheduleAnchor=r.plannedStart;
        }
        snapshot.requirements.push(r);
        if(template&&(base||value.executionMode==='work_items')){
          const mapping=new Map<string,string>(template.items.map((i:{id:string})=>[i.id,c.id+':template:'+i.id]));
          const expansion:TemplateExpansion={requirementId:c.id,key:templateInstanceKey(c),version:template.updatedAt,entities:[],dependencies:[],items:template.items.map((i:{id:string;kind?:string})=>({clientId:mapping.get(i.id)!,templateItemId:i.id,kind:i.kind||'work'}))};
          expanded.set(c.id,expansion);
          for(const item of template.items){const id=mapping.get(item.id)!;
            if(item.kind==='milestone')snapshot.milestones.push({id,projectId:snapshot.projectId,requirementId:c.id,title:item.title,targetDate:null,confirmationMode:item.confirmationMode||'auto',achievedAt:null,version:1});
            else {const dates=base?plannedDatesFromOffset(base,item.startOffsetDays,item.durationDays):{plannedStart:null,plannedEnd:null};snapshot.workItems.push({...workDefaults,...dates,id,requirementId:c.id,title:item.title,durationDays:item.durationDays,arrangement:item.arrangement||'early',arrangementAnchor:mapping.get(item.arrangementAnchor)||null});}
            if(template.dependencyMode==='dependencies'||item.kind==='milestone')for(const pred of item.predecessorIds||[]){const previous=template.items.find((i:{id:string})=>i.id===pred);snapshot.dependencies.push({id:id+':from:'+pred,projectId:snapshot.projectId,sourceRequirementId:c.id,targetRequirementId:c.id,sourceWorkItemId:previous.kind==='milestone'?null:mapping.get(pred)!,sourceMilestoneId:previous.kind==='milestone'?mapping.get(pred):null,targetWorkItemId:item.kind==='milestone'?null:id,targetMilestoneId:item.kind==='milestone'?id:null,origin:'template'});}
          }
          expansion.dependencies=snapshot.dependencies.filter(d=>d.sourceRequirementId===c.id&&d.targetRequirementId===c.id).map(d=>({...d}));
          expansion.entities=[...snapshot.workItems.filter(w=>w.requirementId===c.id).map(w=>({entity:'work' as const,op:'create' as const,id:w.id,requirementId:c.id,data:{title:w.title,ownerId:w.ownerId||null,plannedStart:w.plannedStart,plannedEnd:w.plannedEnd,durationDays:w.durationDays,arrangement:w.arrangement,arrangementAnchor:w.arrangementAnchor}})),...snapshot.milestones.filter(m=>m.requirementId===c.id).map(m=>({entity:'milestone' as const,op:'create' as const,id:m.id,requirementId:c.id,data:{title:m.title,targetDate:m.targetDate,confirmationMode:m.confirmationMode}}))];
          if(template.dependencyMode==='dependencies')r.dependenciesReviewedAt=new Date().toISOString();
          const dates=snapshot.workItems.filter(w=>w.requirementId===c.id).flatMap(w=>w.plannedEnd?[w.plannedEnd]:[]).sort();r.plannedEnd=dates.at(-1)||null;r.status=snapshot.workItems.some(w=>w.requirementId===c.id)?'not_started':'planning';
        }
      }else if(c.op==='update'){
        const {reviewForecast:_reviewForecast,...editable}=c.data;
        if(c.data.reviewForecast&&req!.executionMode!=='direct')fail('分解需求请核对具体工作项的估算');
        const {expectedVersion:_expectedVersion,...normalized}=normalizeRequirementText(updateRequirementInputSchema.parse({...editable,expectedVersion:c.expectedVersion}));
        Object.assign(c.data,normalized);
        validateDeliveryFields(snapshot.projectId,c.data,actor,req as Parameters<typeof validateDeliveryFields>[3]);
        if(c.data.executionMode&&c.data.executionMode!==req!.executionMode){
          if(c.data.executionMode==='direct')fail('画布不支持将有工作项的需求切回直接执行');
          if(['blocked','pending_acceptance'].includes(req!.status))fail('请先解阻或返工，再拆分');
          if(!changes.some(x=>x.entity==='work'&&x.op==='create'&&x.requirementId===req!.id))fail('拆分必须同时建立剩余工作项');
          req!.splitBaseProgress=Math.min(99,req!.progress||0);req!.splitAt=new Date().toISOString();
        }
        Object.assign(req!,c.data);
      }else {if(!['completed','cancelled'].includes(req!.status))fail('未结束需求请使用取消，不能从画布直接归档');req!.deletedAt=new Date().toISOString();}
    }else if(c.entity==='work'){
      if(c.op!=='delete'){const fields=Object.fromEntries(Object.entries(c.data).filter(([key])=>!['durationDays','arrangement','arrangementAnchor'].includes(key)));(c.op==='create'?createWorkItemInputSchema:updateWorkItemInputSchema).parse({...fields,expectedVersion:c.expectedVersion||1});}
      if(c.op==='create'){
        if(!req)notFound('所属需求不存在');if(req.executionMode==='direct')fail('请先选择拆分剩余工作');if(snapshot.workItems.some(w=>w.requirementId===req.id&&w.status!=='not_started')&&!c.data.reason?.trim())fail('需求已执行，新增工作项请填写变更原因');
        snapshot.workItems.push({...workDefaults,...c.data,id:c.id,requirementId:req.id,title:requireLabel(c.data.title,'工作项标题')});
      }else {const w=snapshot.workItems.find(w=>w.id===c.id);if(!w||w.requirementId!==requirementId)notFound('工作项不存在');
        if(c.op==='delete'){if(!canDeleteWorkItem({...w,version:Number(row!.version)} as Parameters<typeof canDeleteWorkItem>[0],!!sqlite.prepare('SELECT 1 FROM progress_updates WHERE work_item_id=? LIMIT 1').get(c.id)))fail('有执行记录的工作项请使用取消');snapshot.workItems=snapshot.workItems.filter(w=>w.id!==c.id);}
        else {if(snapshot.workItems.some(item=>item.requirementId===w.requirementId&&item.status!=='not_started')&&Object.entries(c.data).some(([key,value])=>['title','ownerId','assigneeIds','plannedStart','plannedEnd'].includes(key)&&JSON.stringify(value)!==JSON.stringify(w[key as keyof typeof w]))&&!c.data.reason?.trim())fail('需求已开始执行，调整工作项结构、负责人或排期时必须填写变更原因');if(['completed','cancelled'].includes(w.status))fail('已结束工作项不能编辑','TERMINAL_LOCKED');
          const collaborators=c.data.assigneeIds??w.assigneeIds?.filter(id=>id!==w.ownerId)??[];
          Object.assign(w,c.data,{assigneeIds:collaborators});}
      }
    }else{
      if(Object.keys(c.data).some(key=>!['title','targetDate','confirmationMode'].includes(key)))fail('里程碑包含不支持的属性');
      const m=snapshot.milestones.find(m=>m.id===c.id);
      if(c.op==='create')snapshot.milestones.push({id:c.id,projectId:snapshot.projectId,requirementId:requirementId||null,title:requireLabel(c.data.title,'里程碑标题'),targetDate:c.data.targetDate||null,confirmationMode:c.data.confirmationMode||'auto',achievedAt:null,version:1});
      else {if(!m)notFound('里程碑不存在');if(m.achievedAt)fail('已达成里程碑请先重新打开');if(c.op==='delete'){if(sqlite.prepare("SELECT 1 FROM audit_logs WHERE entity_type='milestone' AND entity_id=? AND action IN ('achieve','reopen') LIMIT 1").get(c.id))fail('里程碑已有达成记录，不能删除历史对象');snapshot.milestones=snapshot.milestones.filter(m=>m.id!==c.id);}else Object.assign(m,c.data);}
    }
  }
  for(const c of changes)if(c.entity==='requirement'&&c.op==='create'&&!expanded.has(c.id)){const r=snapshot.requirements.find(r=>r.id===c.id)!;r.dependenciesReviewedAt=new Date().toISOString();r.scheduleAnchor=r.plannedStart||snapshot.asOfDate;}
  // The preview and commitment snapshot use the same dates that work-item writes derive.
  for(const id of new Set(changes.filter(c=>c.entity==='work').map(c=>c.requirementId||snapshot.workItems.find(w=>w.id===c.id)?.requirementId))){
    const r=snapshot.requirements.find(r=>r.id===id);if(!r||r.executionMode==='direct')continue;
    const metrics=deriveRequirementMetrics(r,snapshot.workItems.filter(w=>w.requirementId===id),snapshot.asOfDate,snapshot.highRiskDelayDays);
    r.plannedStart=metrics.plannedStart;r.plannedEnd=metrics.plannedEnd;r.progress=metrics.progress;r.status=metrics.status;
  }
  if(changes.length)refreshPathAssignments(snapshot);
  return expanded;
}

export function prepareEditorLayouts(snapshot:PathInput,layouts:NonNullable<DependencyChanges['layouts']>,actor:Actor){
  const current=requireAuthorizationActor(actor);
  if(new Set(layouts.map(l=>l.scope+':'+l.direction)).size!==layouts.length)fail('布局重复提交');
  for(const layout of layouts){
    if(layout.scope==='global')assertProjectManager(current,snapshot.projectId);
    else if(layout.scope.startsWith('requirement:')){const id=layout.scope.slice(12);if(!snapshot.requirements.some(r=>r.id===id&&!r.deletedAt))notFound('布局需求不存在');if(sqlite.prepare('SELECT 1 FROM requirements WHERE id=?').get(id))assertRequirementOwnerOrManager(current,id);else assertProjectManager(current,snapshot.projectId);}
    else fail('布局范围不合法');
    const old=snapshot.layouts?.find(l=>l.scope===layout.scope&&l.direction===layout.direction);
    if((old?.version||0)!==layout.expectedVersion)fail('共享布局已更新，请核对','STALE_WRITE',409,{layoutScopes:[layout.scope]});
    snapshot.layouts=[...(snapshot.layouts||[]).filter(l=>l.scope!==layout.scope||l.direction!==layout.direction),{...layout,version:layout.expectedVersion}];
  }
}

export function persistEditorEntities(snapshot:PathInput,changes:EditorEntityChange[],expanded:Map<string,TemplateExpansion>,actor:Actor,removed:string[]=[]){
  const ids:Record<string,string>={},now=new Date().toISOString();
  for(const c of [...changes].sort((a,b)=>Number(b.entity==='requirement')-Number(a.entity==='requirement'))){
    const {reviewForecast:_review,...data}=c.data,reqId=ids[c.requirementId||'']||c.requirementId,entityId=ids[c.id]||c.id;
    if(c.entity==='requirement'){
      if(c.op==='create'){
        delete data.reason;
        const r=createRequirement({...data,templateId:data.templateId||undefined,projectId:snapshot.projectId},actor,true);ids[c.id]=r.id;if(!expanded.has(c.id))sqlite.prepare('UPDATE requirements SET dependencies_reviewed_at=?,schedule_anchor=? WHERE id=?').run(now,snapshot.requirements.find(value=>value.id===c.id)?.scheduleAnchor||snapshot.asOfDate,r.id);
        for(const e of expanded.get(c.id)?.items||[]){const record=e.kind==='milestone'?sqlite.prepare('SELECT id FROM milestones WHERE requirement_id=? AND template_item_id=?').get(r.id,e.templateItemId) as {id:string}|undefined:r.workItems?.find(w=>w.templateItemId===e.templateItemId);if(!record)fail('流程实例化结果不完整');ids[e.clientId]=record.id;}
        for(const e of expanded.get(c.id)?.dependencies||[]){
          const record=sqlite.prepare('SELECT id FROM dependency_edges WHERE source_requirement_id=? AND target_requirement_id=? AND source_work_item_id IS ? AND target_work_item_id IS ? AND source_milestone_id IS ? AND target_milestone_id IS ?').get(r.id,r.id,e.sourceWorkItemId?ids[e.sourceWorkItemId]:null,e.targetWorkItemId?ids[e.targetWorkItemId]:null,e.sourceMilestoneId?ids[e.sourceMilestoneId]:null,e.targetMilestoneId?ids[e.targetMilestoneId]:null) as {id:string}|undefined;
          if(!record)fail('流程实例化关系不完整');ids[e.id]=record.id;
          if(removed.includes(e.id))sqlite.prepare('DELETE FROM dependency_edges WHERE id=?').run(record.id);
        }
      }else if(c.op==='update'){if(_review&&Object.keys(data).every(k=>k==='reason')){sqlite.prepare('UPDATE requirements SET version=version+1,updated_at=? WHERE id=?').run(now,c.id);}else if(data.executionMode||Object.keys(data).some(k=>['deliveryScope','acceptanceOwnerId','durationDays','forecastEnd','unblockEstimate',...coordinationKeys].includes(k)))updateDeliveryRequirement(c.id,{...data,expectedVersion:c.expectedVersion},actor,!!data.executionMode,true);else updateRequirement(c.id,{...data,expectedVersion:c.expectedVersion},actor,true);}
      else archiveRequirement(c.id,{expectedVersion:c.expectedVersion},actor,true);
    }else if(c.entity==='work'){
      const {durationDays:_durationDays,arrangement:_arrangement,arrangementAnchor:_arrangementAnchor,...fields}=data;
      if(c.op==='create'){const r=sqlite.prepare('SELECT version FROM requirements WHERE id=?').get(reqId) as {version:number};const w=createWorkItem(reqId!,{...fields,expectedVersion:r.version},actor,true)!;ids[c.id]=w.id;}
      else if(c.op==='update')updateWorkItem(entityId,{...fields,expectedVersion:c.expectedVersion??1},actor,true);
      else deleteWorkItem(entityId,{expectedVersion:c.expectedVersion??1},actor,true);
    }else{
      const m=snapshot.milestones?.find(m=>m.id===c.id);
      if(c.op==='create'){ids[c.id]=c.id;sqlite.prepare('INSERT INTO milestones(id,project_id,requirement_id,title,target_date,confirmation_mode,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(c.id,snapshot.projectId,reqId||null,m!.title,m!.targetDate,m!.confirmationMode,now,now);}
      else if(c.op==='update')sqlite.prepare('UPDATE milestones SET title=?,target_date=?,confirmation_mode=?,version=version+1,updated_at=? WHERE id=?').run(m!.title,m!.targetDate,m!.confirmationMode,now,entityId);
      else sqlite.prepare('DELETE FROM milestones WHERE id=?').run(entityId);
    }
  }
  // Resolve estimates only after every new endpoint has its final ID, including forward references.
  for(const c of changes)if(c.entity==='work'&&(c.op==='create'||c.op==='update'&&['durationDays','arrangement','arrangementAnchor'].some(key=>key in c.data))){
    const w=snapshot.workItems.find(w=>w.id===c.id)!;
    sqlite.prepare('UPDATE work_items SET duration_days=?,arrangement=?,arrangement_anchor=?,version=version+1 WHERE id=?').run(w.durationDays,w.arrangement||'early',w.arrangementAnchor?remapPathNodeId(w.arrangementAnchor,ids):null,ids[c.id]||c.id);
  }
  return ids;
}
