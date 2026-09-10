import {z} from 'zod';
import type {FastifyInstance,preHandlerHookHandler} from 'fastify';
import type {Actor} from './auth';
import {actorFromRequest} from './authorization';
import {createDraftInput,updateDraftInput,listDraftInput,closeDraftInput,draftVersionInput,templateDraftInput,publishDraftInput} from '../shared/requirement-drafts';
import {createRequirementDraft,listRequirementDrafts,getRequirementDraft,updateRequirementDraft,closeRequirementDraft,previewRequirementDraft,previewRequirementDraftTemplate,previewRequirementDraftPlan,getRequirementDraftPublishReceipt,publishRequirementDraft,getRequirementDraftContext} from './services/requirement-drafts';

type Operation={name:string;description:string;method:'GET'|'POST'|'PUT';path:string;inputSchema:z.ZodObject;execute:(value:unknown,actor:Actor)=>unknown};
const id={draftId:z.string().min(1)},base='/api/my/requirement-drafts';
function op<T extends z.ZodObject>(name:string,description:string,method:Operation['method'],path:string,inputSchema:T,run:(v:z.infer<T>,actor:Actor)=>unknown):Operation{return {name,description,method,path:base+path,inputSchema,execute:(v,a)=>run(inputSchema.parse(v),a)};}
export const requirementDraftOperations:Operation[]=[
  op('create_requirement_draft','默认录入入口：保存到 Token 账号的个人空间，指定目标项目；不写正式项目。人员留给人类，请求ID防重。','POST','',createDraftInput,(v,a)=>createRequirementDraft(v,a)),
  op('list_requirement_drafts','分页查询本人个人草稿；同账号不同 Token 可接续，其他人包括管理员不可读。','GET','',listDraftInput,(v,a)=>listRequirementDrafts(v,a)),
  op('get_requirement_draft','读取本人的草稿、内容版本、状态及回执。项目权限失效后仅保留个人内容。','GET','/:draftId',z.object(id).strict(),(v,a)=>getRequirementDraft(v.draftId,a)),
  op('update_requirement_draft','保存完整方案，带预期版本和请求ID；冲突后先读取合并，不覆盖新版。已有成果仅引用。','PUT','/:draftId',updateDraftInput.extend(id),(v,a)=>{const{draftId,...input}=v;return updateRequirementDraft(draftId,input,a)}),
  op('preview_requirement_draft','校验已保存版本的需求、来源和完整执行网络；返回阻断项及待确认项，不写正式数据。','POST','/:draftId/preview',draftVersionInput.extend(id),(v,a)=>previewRequirementDraft(v.draftId,{expectedVersion:v.expectedVersion},a)),
  op('preview_requirement_draft_template','只读展开项目工作流，返回模板版本、工作、里程碑及依赖。核对后用 update 保存结果，模板变化不覆盖人工编辑。','POST','/:draftId/template-preview',templateDraftInput.extend(id),(v,a)=>{const{draftId,...input}=v;return previewRequirementDraftTemplate(draftId,input,a)}),
  op('preview_requirement_draft_plan','用正式项目与本草稿预览完整网络排期影响；展示未知工期，不分配人员，不写正式计划。','POST','/:draftId/plan-preview',draftVersionInput.extend(id),(v,a)=>previewRequirementDraftPlan(v.draftId,{expectedVersion:v.expectedVersion},a)),
  op('close_requirement_draft','关闭本人未发布草稿；保留内容，只读。','POST','/:draftId/close',closeDraftInput.extend(id),(v,a)=>{const{draftId,...input}=v;return closeRequirementDraft(draftId,input,a)}),
  op('get_requirement_draft_publish_receipt','查询本人网页发布批次结果。结果未知先查回执。MCP 不提供发布。','GET','/:draftId/receipts/:batchId',z.object({...id,batchId:z.uuid()}).strict(),(v,a)=>getRequirementDraftPublishReceipt(v.draftId,v.batchId,a)),
];
export function registerRequirementDraftRoutes(app:FastifyInstance,requireReady:preHandlerHookHandler){
  for(const operation of requirementDraftOperations)app.route({method:operation.method,url:operation.path,preHandler:requireReady,bodyLimit:10*1024*1024,handler:async request=>operation.execute({...request.query as object,...request.body as object,...request.params as object},actorFromRequest(request))});
  app.get<{Params:{draftId:string}}>(base+'/:draftId/context',{preHandler:requireReady},async request=>getRequirementDraftContext(request.params.draftId,actorFromRequest(request)));
  app.post<{Params:{draftId:string}}>(base+'/:draftId/publish',{preHandler:requireReady},async request=>publishRequirementDraft(request.params.draftId,publishDraftInput.parse(request.body),actorFromRequest(request)));
}
