import { z } from 'zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Actor } from './auth';
import { actorFromRequest } from './authorization';
import { groupInput, groupDeleteInput, organizationInput, importPreviewInput, importApplyInput } from '../shared/intake';
import { readIntakeCatalog, saveGroup, deleteGroup, updateOrganization } from './services/intake-metadata';
import { getGroupOverview } from './services/group-overview';
import { archiveFeature, listFeatures, readFeatureRequirements, listFeatureRelations, saveFeatureRelation, deleteFeatureRelation } from './services/features';
import { featureRelationInput } from '../shared/features';
import { previewRequirementImport, applyRequirementImport, getRequirementImportReceipt } from './services/requirement-import';

type Operation={name:string;description:string;method:'GET'|'POST'|'DELETE';path:string;inputSchema:z.ZodObject;execute:(value:unknown,actor:Actor)=>unknown};
const project={projectId:z.string().min(1)};
const base='/api/projects/:projectId';
const state=z.enum(['active','archived','all']).default('active');
function operation<T extends z.ZodObject>(name:string,description:string,method:Operation['method'],path:string,inputSchema:T,run:(value:z.infer<T>,actor:Actor)=>unknown):Operation {
  return {name,description,method,path:base+path,inputSchema,execute:(value,actor)=>run(inputSchema.parse(value),actor)};
}
export const intakeOperations:Operation[]=[
  operation('get_group_overview','读取特性总体进展：人工预期与判断、需求计数及最近进展；state 默认 active，可查询 archived/all；计数不代表符合预期程度','GET','/group-overview',z.object({...project,state}).strict(),(v,a)=>getGroupOverview(v.projectId,a,undefined,v.state)),
  operation('get_requirement_intake','读取需求分组','GET','/requirement-intake',z.object(project).strict(),(v,a)=>{const {revision,groups}=readIntakeCatalog(v.projectId,a);return {revision,groups};}),
  operation('list_requirement_groups','读取长期特性；state 默认 active，可查询 archived/all','GET','/requirement-groups',z.object({...project,state}).strict(),(v,a)=>listFeatures(v.projectId,v.state,a)),
  operation('save_requirement_group','新建或更新长期特性；description 为长期目标与范围，更新须带版本；可选 overview 保存人工预期与判断，省略时保留原评估','POST','/requirement-groups',groupInput.extend(project),(v,a)=>{const{projectId,...input}=v;return saveGroup(projectId,input,a);}),
  operation('delete_requirement_group','仅删除没有需求（含归档取消项）及规划连线的空特性；非空特性请归档','DELETE','/requirement-groups/:groupId',groupDeleteInput.extend({...project,groupId:z.string().min(1)}),(v,a)=>deleteGroup(v.projectId,v.groupId,v.expectedVersion,a)),
  operation('archive_requirement_group','归档特性；必须先处理所有未完成需求，保留需求和规划关系','POST','/requirement-groups/:groupId/archive',groupDeleteInput.extend({...project,groupId:z.string().min(1)}),(v,a)=>archiveFeature(v.projectId,v.groupId,v.expectedVersion,true,a)),
  operation('restore_requirement_group','恢复归档特性，保留原有资料和关系','POST','/requirement-groups/:groupId/restore',groupDeleteInput.extend({...project,groupId:z.string().min(1)}),(v,a)=>archiveFeature(v.projectId,v.groupId,v.expectedVersion,false,a)),
  operation('get_feature_requirements','分页读取特性需求摘要；state=current 包含未归档需求，archived 为只读历史；groupId=ungrouped 表示未归属集合','GET','/requirement-groups/:groupId/requirements',z.object({...project,groupId:z.string().min(1),state:z.enum(['current','archived']).default('current'),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}),(v,a)=>readFeatureRequirements(v.projectId,v.groupId,v.state,v.page,v.pageSize,a)),
  operation('list_feature_relations','读取人工特性规划关系，含归档特性保留的关系；不参与排期','GET','/feature-relations',z.object(project),(v,a)=>listFeatureRelations(v.projectId,a)),
  operation('save_feature_relation','保存人工前置特性到后续特性的规划关系，禁止规划循环；更新需要 expectedVersion，不修改执行依赖','POST','/feature-relations',featureRelationInput.extend(project),(v,a)=>{const {projectId,...input}=v;return saveFeatureRelation(projectId,input,a);}),
  operation('delete_feature_relation','删除指定人工规划关系，需要 expectedVersion，不删除实际依赖','DELETE','/feature-relations/:relationId',groupDeleteInput.extend({...project,relationId:z.string().min(1)}),(v,a)=>deleteFeatureRelation(v.projectId,v.relationId,v.expectedVersion,a)),
  operation('update_requirement_organization','批量调整未归档需求的特性归属（含已完成与取消项），保留执行事实','POST','/requirement-organization',organizationInput.safeExtend(project),(v,a)=>{const{projectId,...input}=v;return updateOrganization(projectId,input,a);}),
  operation('preview_requirement_import','预览需求导入，不保存业务数据；返回版本和预览凭据','POST','/requirement-import/preview',importPreviewInput.extend(project),(v,a)=>previewRequirementImport(v.projectId,{package:v.package},a)),
  operation('apply_requirement_import','按预览凭据和批次ID原子导入，重试不重复创建；结果未知先查询回执','POST','/requirement-import/apply',importApplyInput.extend(project),(v,a)=>{const{projectId,...input}=v;return applyRequirementImport(projectId,input,a);}),
  operation('get_requirement_import_receipt','查询当前账号的导入提交回执','GET','/requirement-import/receipts/:batchId',z.object({...project,batchId:z.string().uuid()}).strict(),(v,a)=>getRequirementImportReceipt(v.projectId,v.batchId,a)),
];
export function registerIntakeRoutes(app:FastifyInstance,requireReady:preHandlerHookHandler) {
  for(const op of intakeOperations)app.route({method:op.method,url:op.path,preHandler:requireReady,bodyLimit:10*1024*1024,handler:async request=>op.execute({...request.query as object,...request.body as object,...request.params as object},actorFromRequest(request))});
}
