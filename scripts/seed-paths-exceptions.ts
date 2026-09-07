import path from 'node:path';
import {config} from '../src/server/config';
import {addBusinessDays,todayIso} from '../src/shared/domain';
if(path.basename(config.rootDir)!=='project-manage-paths'||!config.dbPath.startsWith(path.join(config.rootDir,'.preview')+path.sep)||config.port!==3220)throw new Error('只能写入隔离试用库');
const {sqlite}=await import('../src/server/database');const s=await import('../src/server/services');const p=await import('../src/server/services/paths');
const admin=sqlite.prepare('SELECT id FROM accounts WHERE is_builtin=1').get() as {id:string};const actor={type:'user' as const,id:admin.id,accountId:admin.id,label:'独立样例',globalRole:'admin' as const,personId:null};
if(sqlite.prepare("SELECT 1 FROM projects WHERE name='路径异常试用'").get()){console.log('异常样例已存在，保留试用修改');sqlite.close();process.exit(0);}
const day=addBusinessDays(todayIso(),0),project=s.createProject({name:'路径异常试用',plannedEnd:addBusinessDays(day,8)},actor);const projectId=project.id;
const owner=s.createPerson({projectId,name:'异常样例负责人'},actor);const template=s.createTemplate({projectId,name:'分段交付',dependencyMode:'dependencies',items:[{clientKey:'a',title:'设计交付',durationDays:2,startOffsetDays:0,sortOrder:0,predecessorKeys:[]},{clientKey:'b',title:'开发联调',durationDays:2,startOffsetDays:2,sortOrder:1,predecessorKeys:['a'],milestoneLabel:'可验收'}]},actor)!;
const create=(title:string)=>{const r=s.createRequirement({projectId,title,templateId:template.id,ownerId:owner.id,plannedStart:day},actor);for(const w of r.workItems!)s.updateWorkItem(w.id,{expectedVersion:w.version,ownerId:owner.id},actor);return s.getRequirement(r.id);};
const a=create('A 平台设计与联调'),b=create('B 业务开发与联调'),c=create('C 已取消的交付点'),d=create('D 等待被取消交付'),e=create('E 等待验收');
const add=(source:typeof a,si:number,target:typeof a,ti:number)=>p.addDependency(projectId,{expectedRevision:p.getPathAnalysis(projectId).revision,sourceRequirementId:source.id,sourceWorkItemId:source.workItems![si].id,targetRequirementId:target.id,targetWorkItemId:target.workItems![ti].id},actor);
add(a,0,b,0);add(b,0,a,1);add(c,0,d,1);
let first=s.getRequirement(a.id).workItems![0];s.startWorkItem(first.id,{expectedVersion:first.version},actor);first=s.getRequirement(a.id).workItems![0];s.blockWorkItem(first.id,{expectedVersion:first.version,reason:'外部环境交付时间尚未确认'},actor);
const cancelled=s.getRequirement(c.id).workItems![0];s.cancelWorkItem(cancelled.id,{expectedVersion:cancelled.version,reason:'供应方取消本阶段成果，需重新选择前置'},actor);
for(const id of e.workItems!.map(w=>w.id)){let w=s.getRequirement(e.id).workItems!.find(w=>w.id===id)!;s.startWorkItem(id,{expectedVersion:w.version},actor);w=s.getRequirement(e.id).workItems!.find(w=>w.id===id)!;s.completeWorkItem(id,{expectedVersion:w.version,content:'样例交付完成，等待项目经理验收'},actor);}
console.log(JSON.stringify({projectId,requirements:[a,b,c,d,e].map(r=>({id:r.id,title:r.title})),forecast:p.getPathAnalysis(projectId).forecastEnd}));sqlite.close();
