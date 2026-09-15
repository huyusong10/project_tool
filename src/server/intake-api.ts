import {orderOutline,archiveFeatures,restoreOutline} from './services/outline';
import {outlineOrderInput,featureArchiveBatchInput,outlineRestoreInput} from '../shared/outline';
import { listFeaturePhases, saveFeaturePhase, commandFeaturePhase } from './services/feature-phases';
import { phaseInput, phaseCommand } from '../shared/feature-phases';
import { recordTestSubmission } from './services/test-submission';
import { z } from 'zod';
import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import type { Actor } from './auth';
import { actorFromRequest } from './authorization';
import { featureInput, featureDeleteInput, organizationInput, importPreviewInput, importApplyInput } from '../shared/intake';
import { readIntakeCatalog, saveFeatureCatalog, deleteFeatureCatalog, updateOrganization } from './services/intake-metadata';
import { getFeatureOverview } from './services/feature-overview';
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
  operation('restore_outline','撤销排序或需求移动；核对涉及的完整同级集合和版本，冲突整批回滚','POST','/outline-restore',outlineRestoreInput.extend(project),(v,a)=>{const {projectId,...input}=v;return restoreOutline(projectId,input,a);}),
  operation('order_outline','按人工顺序排列完整同级集合；携带全部对象版本，冲突整批回滚','POST','/outline-order',outlineOrderInput.extend(project),(v,a)=>{const {projectId,...input}=v;return orderOutline(projectId,input,a);}),
  operation('archive_features','批量归档特性；任一特性存在未完成需求或版本冲突则整批回滚','POST','/features/archive-batch',featureArchiveBatchInput.extend(project),(v,a)=>{const {projectId,...input}=v;return archiveFeatures(projectId,input,a);}),
  operation('list_feature_phases','读取特性 Phase、阶段分布与交付历史','GET','/feature-phases',z.object({...project,featureId:z.string().optional()}).strict(),(v,a)=>listFeaturePhases(v.projectId,v.featureId,a)),
  operation('save_feature_phase','创建或修改 Phase；推进后的范围日期调整需要原因','POST','/features/:featureId/phases',phaseInput.extend({...project,featureId:z.string()}),(v,a)=>{const {projectId,featureId,...input}=v;return saveFeaturePhase(projectId,featureId,input,a);}),
  ...(['deliver','reopen','delete'] as const).map(action=>operation(action+'_feature_phase',({deliver:'确认 Phase 交付；全部有效需求完成后操作',reopen:'重新打开 Phase；填写原因并保留交付记录',delete:'删除没有需求及交付历史的空 Phase'})[action],action==='delete'?'DELETE':'POST',action==='delete'?'/feature-phases/:phaseId':'/feature-phases/:phaseId/'+action,phaseCommand.extend({...project,phaseId:z.string()}),(v,a)=>{const{projectId,phaseId,...input}=v;return commandFeaturePhase(projectId,phaseId,action,input,a);})),
  operation('record_test_submission','记录需求实际提测；不会将提测就绪当作已提测','POST','/requirements/:requirementId/test-submission',z.object({...project,requirementId:z.string(),expectedVersion:z.number().int().positive(),actualDate:z.string(),content:z.string().trim().max(2000).optional()}).strict(),(v,a)=>recordTestSubmission(v,a)),
  operation('get_feature_overview','读取特性目标、各 Phase 状态、阶段分布、交付日期与历史、人工评估；不计算特性总百分比。已完成归档需求保留 Phase 交付贡献。state 默认 active，可选 archived/all','GET','/feature-overview',z.object({...project,state}).strict(),(v,a)=>getFeatureOverview(v.projectId,a,undefined,v.state)),
  operation('get_requirement_intake','读取特性','GET','/requirement-intake',z.object(project).strict(),(v,a)=>{const {revision,features}=readIntakeCatalog(v.projectId,a);return {revision,features};}),
  operation('list_features','读取长期特性；state 默认 active，可查询 archived/all','GET','/features',z.object({...project,state}).strict(),(v,a)=>listFeatures(v.projectId,v.state,a)),
  operation('save_feature','新建或更新长期特性；description 为长期目标与范围，更新须带版本；可选 overview 保存人工预期与判断，省略时保留原评估','POST','/features',featureInput.extend(project),(v,a)=>{const{projectId,...input}=v;return saveFeatureCatalog(projectId,input,a);}),
  operation('delete_feature','仅删除没有需求（含归档取消项）及规划连线的空特性；非空特性请归档','DELETE','/features/:featureId',featureDeleteInput.extend({...project,featureId:z.string().min(1)}),(v,a)=>deleteFeatureCatalog(v.projectId,v.featureId,v.expectedVersion,a)),
  operation('archive_feature','归档特性；必须先处理所有未完成需求，保留需求和规划关系','POST','/features/:featureId/archive',featureDeleteInput.extend({...project,featureId:z.string().min(1)}),(v,a)=>archiveFeature(v.projectId,v.featureId,v.expectedVersion,true,a)),
  operation('restore_feature','恢复归档特性，保留原有资料和关系','POST','/features/:featureId/restore',featureDeleteInput.extend({...project,featureId:z.string().min(1)}),(v,a)=>archiveFeature(v.projectId,v.featureId,v.expectedVersion,false,a)),
  operation('get_feature_requirements','分页读取特性需求摘要；state=current 包含未归档需求，archived 为只读历史；featureId=unassigned 表示未关联特性集合','GET','/features/:featureId/requirements',z.object({...project,featureId:z.string().min(1),state:z.enum(['current','archived']).default('current'),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}),(v,a)=>readFeatureRequirements(v.projectId,v.featureId,v.state,v.page,v.pageSize,a)),
  operation('list_feature_relations','读取人工特性规划关系，含归档特性保留的关系；不参与排期','GET','/feature-relations',z.object(project),(v,a)=>listFeatureRelations(v.projectId,a)),
  operation('save_feature_relation','保存人工前置特性到后续特性的规划关系，禁止规划循环；更新需要 expectedVersion，不修改执行依赖','POST','/feature-relations',featureRelationInput.extend(project),(v,a)=>{const {projectId,...input}=v;return saveFeatureRelation(projectId,input,a);}),
  operation('delete_feature_relation','删除指定人工规划关系，需要 expectedVersion，不删除实际依赖','DELETE','/feature-relations/:relationId',featureDeleteInput.extend({...project,relationId:z.string().min(1)}),(v,a)=>deleteFeatureRelation(v.projectId,v.relationId,v.expectedVersion,a)),
  operation('update_requirement_placement','批量设置 featureId/phaseId；每条需求携带 expectedVersion，失败整批回滚。推进后调整填写 reason，已交付 Phase 必须先重新打开；保留执行事实','POST','/requirement-placement',organizationInput.safeExtend(project),(v,a)=>{const{projectId,...input}=v;return updateOrganization(projectId,input,a);}),
  operation('preview_requirement_import','预览 formatVersion:3 的需求导入，使用 feature/phase 和 workItems[].workStage；不保存业务数据，返回版本和预览凭据','POST','/requirement-import/preview',importPreviewInput.extend(project),(v,a)=>previewRequirementImport(v.projectId,{package:v.package},a)),
  operation('apply_requirement_import','按预览凭据和批次ID原子导入，重试不重复创建；结果未知先查询回执','POST','/requirement-import/apply',importApplyInput.extend(project),(v,a)=>{const{projectId,...input}=v;return applyRequirementImport(projectId,input,a);}),
  operation('get_requirement_import_receipt','查询当前账号的导入提交回执','GET','/requirement-import/receipts/:batchId',z.object({...project,batchId:z.string().uuid()}).strict(),(v,a)=>getRequirementImportReceipt(v.projectId,v.batchId,a)),
];
export function registerIntakeRoutes(app:FastifyInstance,requireReady:preHandlerHookHandler) {
  for(const op of intakeOperations)app.route({method:op.method,url:op.path,preHandler:requireReady,bodyLimit:10*1024*1024,handler:async request=>op.execute({...request.query as object,...request.body as object,...request.params as object},actorFromRequest(request))});
}
