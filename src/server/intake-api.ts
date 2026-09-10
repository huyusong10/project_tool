import { z } from 'zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Actor } from './auth';
import { actorFromRequest } from './authorization';
import { groupInput, groupDeleteInput, organizationInput, sourceWriteInput, sourceLinkInput, sourceLinkDeleteInput, deferClauseInput, importPreviewInput, importApplyInput } from '../shared/intake';
import { readIntakeCatalog, saveGroup, deleteGroup, updateOrganization, saveSources, saveSourceLink, deleteSourceLink, deferSourceClause } from './services/intake-metadata';
import { previewRequirementImport, applyRequirementImport, getRequirementImportReceipt } from './services/requirement-import';

type Operation={name:string;description:string;method:'GET'|'POST'|'DELETE';path:string;inputSchema:z.ZodObject;execute:(value:unknown,actor:Actor)=>unknown};
const project={projectId:z.string().min(1)};
const base='/api/projects/:projectId';
function operation<T extends z.ZodObject>(name:string,description:string,method:Operation['method'],path:string,inputSchema:T,run:(value:z.infer<T>,actor:Actor)=>unknown):Operation {
  return {name,description,method,path:base+path,inputSchema,execute:(value,actor)=>run(inputSchema.parse(value),actor)};
}
export const intakeOperations:Operation[]=[
  operation('get_requirement_intake','读取分组、标签、来源条款及落实范围','GET','/requirement-intake',z.object(project).strict(),(v,a)=>readIntakeCatalog(v.projectId,a)),
  operation('list_requirement_groups','读取项目需求分组','GET','/requirement-groups',z.object(project).strict(),(v,a)=>readIntakeCatalog(v.projectId,a).groups),
  operation('list_requirement_sources','读取来源文档、条款、关联及版本核对状态','GET','/requirement-sources',z.object(project).strict(),(v,a)=>readIntakeCatalog(v.projectId,a)),
  operation('save_requirement_group','新建或更新单层需求分组；更新须带版本','POST','/requirement-groups',groupInput.extend(project),(v,a)=>{const{projectId,...input}=v;return saveGroup(projectId,input,a);}),
  operation('delete_requirement_group','删除分组，需求保留并移入未分组','DELETE','/requirement-groups/:groupId',groupDeleteInput.extend({...project,groupId:z.string().min(1)}),(v,a)=>deleteGroup(v.projectId,v.groupId,v.expectedVersion,a)),
  operation('update_requirement_organization','批量修改未结束需求的分组与标签，保留执行事实','POST','/requirement-organization',organizationInput.safeExtend(project),(v,a)=>{const{projectId,...input}=v;return updateOrganization(projectId,input,a);}),
  operation('save_requirement_sources','按稳定来源标识更新条款；保留旧版本与已有验收记录','POST','/requirement-sources',sourceWriteInput.extend(project),(v,a)=>{const{projectId,...input}=v;return saveSources(projectId,input,a);}),
  operation('save_requirement_source_link','维护需求或工作项的来源落实范围；结束需求须经理填写纠错原因','POST','/requirement-source-links',sourceLinkInput.extend(project),(v,a)=>{const{projectId,...input}=v;return saveSourceLink(projectId,input,a);}),
  operation('delete_requirement_source_link','移除来源关联；不修改执行和验收事实','DELETE','/requirement-source-links/:linkId',sourceLinkDeleteInput.extend({...project,linkId:z.string().min(1)}),(v,a)=>{const{projectId,linkId,...input}=v;return deleteSourceLink(projectId,linkId,input,a);}),
  operation('defer_requirement_source_clause','填写暂缓原因，空字符串恢复安排','POST','/requirement-sources/clauses/:clauseId/defer',deferClauseInput.extend({...project,clauseId:z.string().min(1)}),(v,a)=>{const{projectId,clauseId,...input}=v;return deferSourceClause(projectId,clauseId,input,a);}),
  operation('preview_requirement_import','预览结构化来源与交付导入，不保存业务数据；返回版本和预览凭据','POST','/requirement-import/preview',importPreviewInput.extend(project),(v,a)=>previewRequirementImport(v.projectId,{package:v.package},a)),
  operation('apply_requirement_import','按预览凭据和批次ID原子导入，重试不重复创建；结果未知先查询回执','POST','/requirement-import/apply',importApplyInput.extend(project),(v,a)=>{const{projectId,...input}=v;return applyRequirementImport(projectId,input,a);}),
  operation('get_requirement_import_receipt','查询当前账号的导入提交回执','GET','/requirement-import/receipts/:batchId',z.object({...project,batchId:z.string().uuid()}).strict(),(v,a)=>getRequirementImportReceipt(v.projectId,v.batchId,a)),
];
export function registerIntakeRoutes(app:FastifyInstance,requireReady:preHandlerHookHandler) {
  for(const op of intakeOperations)app.route({method:op.method,url:op.path,preHandler:requireReady,bodyLimit:10*1024*1024,handler:async request=>op.execute({...request.query as object,...request.body as object,...request.params as object},actorFromRequest(request))});
}
