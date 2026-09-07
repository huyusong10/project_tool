import path from 'node:path';
import { config } from '../src/server/config';
import { addBusinessDays, todayIso } from '../src/shared/domain';
if (path.basename(config.rootDir)!=='project-manage-paths'||!config.dbPath.startsWith(path.join(config.rootDir,'.preview')+path.sep)||config.port!==3220) throw new Error('只允许写入隔离试用库');
const {sqlite}=await import('../src/server/database');
const svc=await import('../src/server/services');
const {getPathAnalysis,addDependency,updatePathEstimate}=await import('../src/server/services/paths');
const admin=sqlite.prepare("SELECT id FROM accounts WHERE is_builtin=1").get() as {id:string};
const actor={type:'user' as const,id:admin.id,accountId:admin.id,label:'独立试用管理员',globalRole:'admin' as const,personId:null};
if(sqlite.prepare("SELECT 1 FROM projects WHERE name='交付依赖试用'").get()){console.log('试用项目已存在，保留所有试用修改');sqlite.close();process.exit(0);}
const start=addBusinessDays(todayIso(),0),due=addBusinessDays(start,6);
const project=svc.createProject({name:'交付依赖试用',plannedEnd:due},actor);
const projectId=project.id;
const people=['接口负责人','订单负责人','发布负责人'].map(name=>svc.createPerson({projectId,name,jobTitle:'试用成员'},actor));
function template(name:string,rows:Array<[string,number,string[],string?]>) {
  return svc.createTemplate({projectId,name,dependencyMode:'dependencies',description:'隔离试用样例。修改关系、工期或进展后可验证实时分析。',items:rows.map(([title,durationDays,predecessorKeys,milestoneLabel],i)=>({clientKey:String(i),title,durationDays,predecessorKeys,milestoneLabel:milestoneLabel||null,startOffsetDays:0,sortOrder:i}))},actor)!;
}
const ta=template('接口交付流程',[['接口实现',2,[]],['接口交付',1,['0'],'接口可联调'],['接口文档整理',3,['0']]]);
const tb=template('订单交付流程',[['订单页面开发',3,[]],['订单联调',2,['0'],'订单联调完成']]);
const tc=template('版本交付流程',[['版本验证',1,[]],['版本发布',1,['0'],'版本上线']]);
const requirements=[['基础接口交付',ta,people[0]],['订单业务上线',tb,people[1]],['版本验证与发布',tc,people[2]]].map(([title,t,p])=>svc.createRequirement({projectId,title,templateId:(t as {id:string}).id,ownerId:(p as {id:string}).id,plannedStart:start},actor));
for(let i=0;i<requirements.length;i++)for(const w of requirements[i].workItems||[])svc.updateWorkItem(w.id,{ownerId:people[i].id,expectedVersion:w.version},actor);
const [a,b,c]=requirements;
const aw=svc.getRequirement(a.id).workItems!,bw=svc.getRequirement(b.id).workItems!;
addDependency(projectId,{expectedRevision:getPathAnalysis(projectId).revision,sourceRequirementId:a.id,sourceWorkItemId:aw.find(w=>w.title==='接口交付')!.id,targetRequirementId:b.id,targetWorkItemId:bw.find(w=>w.title==='订单联调')!.id},actor);
addDependency(projectId,{expectedRevision:getPathAnalysis(projectId).revision,sourceRequirementId:b.id,targetRequirementId:c.id},actor);
const first=svc.getRequirement(a.id).workItems!.find(w=>w.title==='接口实现')!;
svc.startWorkItem(first.id,{expectedVersion:first.version},actor);
const started=svc.getRequirement(a.id).workItems!.find(w=>w.id===first.id)!;
svc.blockWorkItem(first.id,{expectedVersion:started.version,reason:'等待联调环境开通（试用样例）'},actor);
updatePathEstimate(first.id,{expectedRevision:getPathAnalysis(projectId).revision,unblockEstimate:addBusinessDays(start,2)},actor);
svc.createRequirement({projectId,title:'待规划的后续报表需求'},actor);
// Use the project commitment independently of template-derived baseline dates.
sqlite.prepare('UPDATE requirements SET planned_end=? WHERE project_id=? AND status<>?').run(due,projectId,'planning');
console.log(JSON.stringify({projectId,requirements:requirements.map(r=>({id:r.id,title:r.title})),analysis:getPathAnalysis(projectId).forecastEnd}));
sqlite.close();
