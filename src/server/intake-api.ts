import { z } from 'zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Actor } from './auth';
import { actorFromRequest } from './authorization';
import { groupInput, groupDeleteInput, organizationInput, importPreviewInput, importApplyInput } from '../shared/intake';
import { readIntakeCatalog, saveGroup, deleteGroup, updateOrganization } from './services/intake-metadata';
import { previewRequirementImport, applyRequirementImport, getRequirementImportReceipt } from './services/requirement-import';

type Operation={name:string;description:string;method:'GET'|'POST'|'DELETE';path:string;inputSchema:z.ZodObject;execute:(value:unknown,actor:Actor)=>unknown};
const project={projectId:z.string().min(1)};
const base='/api/projects/:projectId';
function operation<T extends z.ZodObject>(name:string,description:string,method:Operation['method'],path:string,inputSchema:T,run:(value:z.infer<T>,actor:Actor)=>unknown):Operation {
  return {name,description,method,path:base+path,inputSchema,execute:(value,actor)=>run(inputSchema.parse(value),actor)};
}
export const intakeOperations:Operation[]=[
  operation('get_requirement_intake','读取需求分组','GET','/requirement-intake',z.object(project).strict(),(v,a)=>{const {revision,groups}=readIntakeCatalog(v.projectId,a);return {revision,groups};}),
  operation('list_requirement_groups','读取项目需求分组','GET','/requirement-groups',z.object(project).strict(),(v,a)=>readIntakeCatalog(v.projectId,a).groups),
  operation('save_requirement_group','新建或更新单层需求分组；更新须带版本','POST','/requirement-groups',groupInput.extend(project),(v,a)=>{const{projectId,...input}=v;return saveGroup(projectId,input,a);}),
  operation('delete_requirement_group','删除分组，需求保留并移入未分组','DELETE','/requirement-groups/:groupId',groupDeleteInput.extend({...project,groupId:z.string().min(1)}),(v,a)=>deleteGroup(v.projectId,v.groupId,v.expectedVersion,a)),
  operation('update_requirement_organization','批量修改未结束需求的分组，保留执行事实','POST','/requirement-organization',organizationInput.safeExtend(project),(v,a)=>{const{projectId,...input}=v;return updateOrganization(projectId,input,a);}),
  operation('preview_requirement_import','预览需求导入，不保存业务数据；返回版本和预览凭据','POST','/requirement-import/preview',importPreviewInput.extend(project),(v,a)=>previewRequirementImport(v.projectId,{package:v.package},a)),
  operation('apply_requirement_import','按预览凭据和批次ID原子导入，重试不重复创建；结果未知先查询回执','POST','/requirement-import/apply',importApplyInput.extend(project),(v,a)=>{const{projectId,...input}=v;return applyRequirementImport(projectId,input,a);}),
  operation('get_requirement_import_receipt','查询当前账号的导入提交回执','GET','/requirement-import/receipts/:batchId',z.object({...project,batchId:z.string().uuid()}).strict(),(v,a)=>getRequirementImportReceipt(v.projectId,v.batchId,a)),
];
export function registerIntakeRoutes(app:FastifyInstance,requireReady:preHandlerHookHandler) {
  for(const op of intakeOperations)app.route({method:op.method,url:op.path,preHandler:requireReady,bodyLimit:10*1024*1024,handler:async request=>op.execute({...request.query as object,...request.body as object,...request.params as object},actorFromRequest(request))});
}
