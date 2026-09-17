import {ReferenceLinksEditor} from './ReferenceLinks';
import {readReferenceLinks,type ReferenceLink} from '../../shared/reference-links';
import {useDeliveryForm} from '../use-delivery-form';
import { Button } from './Button';
import {assertCleanProjectDraft} from '../use-graph-draft';
import {useSession} from '../app-context';
import { migrateFeatureFields } from "../feature-storage-migration";
import {OrganizationFields} from './RequirementIntake';
import {isAssignablePerson} from '../assignable-people';
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useProjects } from "../app-context";
import { invalidateProjectViews, invalidateRequirementViews, keys } from "../query-keys";
import type { Person, Project, Requirement, WorkItemTemplate } from "../types";
import { FormDisclosure, FormError, FormField, FormSubmitActions } from "./Form";
import { EmptyState, LoadingState } from "./Feedback";
import { Modal } from "./Modal";
import { projectStatusOptions } from "../ui-options";
import { hasWorkdayCalendarFallback } from '../../shared/workday';
import { canonicalizeLabel } from "../../shared/search";
import { useToast } from "./Toast";

export type ProjectFormInput = {
  guestVisible?: boolean;
  name: string;
  status: string;
  plannedStart: string;
  plannedEnd: string;
  defaultTemplateId?: string;
  expectedUpdatedAt?: string;
};
export type ProjectCreateRecheck={draft:ProjectFormInput;baselineIds:string[]};
function projectCreateRecheckKey(accountKey:string){return `project-manage:project-create-recheck:${accountKey}`;}
export function readProjectCreateRecheck(accountKey:string):ProjectCreateRecheck|null{
  try{const raw=sessionStorage.getItem(projectCreateRecheckKey(accountKey));if(!raw)return null;const value=migrateFeatureFields(JSON.parse(raw)) as Partial<ProjectCreateRecheck>,draft=value.draft as Partial<ProjectFormInput>|undefined;return typeof draft?.name==='string'&&typeof draft.status==='string'&&typeof draft.plannedStart==='string'&&typeof draft.plannedEnd==='string'&&(draft.defaultTemplateId===undefined||typeof draft.defaultTemplateId==='string')&&Array.isArray(value.baselineIds)&&value.baselineIds.every(id=>typeof id==='string')?value as ProjectCreateRecheck:null;}catch{return null;}
}
export function persistProjectCreateRecheck(accountKey:string,value:ProjectCreateRecheck|null){try{const key=projectCreateRecheckKey(accountKey);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* 当前页面仍保留核对锁。 */}}

export type RequirementFormInput = {
  featureId?:string|null;phaseId?:string|null;reason?:string;
  projectId: string;
  templateId?: string;
  title: string;
  ownerId: string;
  background: string;
  acceptanceCriteria: string;
  referenceUrl: string; referenceLinks?:ReferenceLink[];
  plannedStart?: string;
  plannedEnd?: string;
};
export type RequirementCreateRecheck={draft:RequirementFormInput;baselineIds:string[]};
function requirementCreateRecheckKey(accountKey:string,projectId:string){return `project-manage:requirement-create-recheck:${accountKey}:${projectId}`;}
export function readRequirementCreateRecheck(accountKey:string,projectId:string):RequirementCreateRecheck|null{
  try{const raw=sessionStorage.getItem(requirementCreateRecheckKey(accountKey,projectId));if(!raw)return null;const value=migrateFeatureFields(JSON.parse(raw)) as Partial<RequirementCreateRecheck>,draft=value.draft as Partial<RequirementFormInput>|undefined;return draft?.projectId===projectId&&typeof draft.title==='string'&&typeof draft.ownerId==='string'&&typeof draft.background==='string'&&typeof draft.acceptanceCriteria==='string'&&typeof draft.referenceUrl==='string'&&Array.isArray(value.baselineIds)&&value.baselineIds.every(id=>typeof id==='string')?value as RequirementCreateRecheck:null;}catch{return null;}
}
export function persistRequirementCreateRecheck(accountKey:string,projectId:string,value:RequirementCreateRecheck|null){try{const key=requirementCreateRecheckKey(accountKey,projectId);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* 当前页面仍保留核对锁。 */}}

export function ProjectForm({
  project,
  createRecheck=null,
  onCreateRecheckChange,
  onClose,
}: {
  project?: Project;
  createRecheck?:ProjectCreateRecheck|null;
  onCreateRecheckChange?:(value:ProjectCreateRecheck|null)=>void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const { projects } = useProjects();
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const initialProjectIds = useRef(new Set(createRecheck?.baselineIds||projects.map((item) => item.id)));
  const [baseProject, setBaseProject] = useState(project);
  const createUnknown=!baseProject&&Boolean(createRecheck);
  const [checkingCreate,setCheckingCreate]=useState(false),[createCheckError,setCreateCheckError]=useState('');
  const initial=project||createRecheck?.draft;
  const [name, setName] = useState(initial?.name || "");
  const [status, setStatus] = useState(initial?.status || "active");
  const [plannedStart, setPlannedStart] = useState(initial?.plannedStart || "");
  const [plannedEnd, setPlannedEnd] = useState(initial?.plannedEnd || "");
  const [guestVisible, setGuestVisible] = useState(Boolean(initial?.guestVisible));
  const [defaultTemplateId, setDefaultTemplateId] = useState(initial?.defaultTemplateId || "");
  const changed = Boolean(project && baseProject && project.updatedAt !== baseProject.updatedAt);
  const templatesQuery = useQuery({
    queryKey: [...keys.templates, project?.id || "new"],
    queryFn: ({ signal }) => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(project!.id)}`, { signal }),
    enabled: Boolean(project?.id),
  });
  const templates = templatesQuery.data || [];
  const templatesReady = !project || templatesQuery.data !== undefined;
  const selectedTemplateUnavailable = Boolean(defaultTemplateId && templatesQuery.data && !templates.some((template) => template.id === defaultTemplateId));
  const mutation = useMutation({
    mutationFn: (data: ProjectFormInput) =>
      api(baseProject ? `/api/projects/${baseProject.id}` : "/api/projects", {
        method: baseProject ? "PATCH" : "POST",
        body: jsonBody(data),
      }),
    onMutate:data=>{if(!baseProject)onCreateRecheckChange?.({draft:data,baselineIds:createRecheck?.baselineIds||[...initialProjectIds.current]});},
    onSuccess: () => {
      if(!baseProject)onCreateRecheckChange?.(null);
      invalidateProjectViews(client);
      onClose();
    },
    onError: async (error, input) => {
      if(!baseProject&&!isWriteOutcomeUnknown(error))onCreateRecheckChange?.(null);
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await api<Project[]>("/api/projects", { readOnly: true });
        const matchesDraft = (item: Project) => item.name === canonicalizeLabel(input.name)
          && Boolean(item.guestVisible) === Boolean(input.guestVisible)
          && item.status === input.status
          && item.plannedStart === (input.plannedStart || null)
          && item.plannedEnd === (input.plannedEnd || null)
          && (baseProject ? item.defaultTemplateId === (input.defaultTemplateId || null) : !item.isSample);
        let saved: Project | undefined;
        if (baseProject) {
          saved = latest.find((item) => item.id === baseProject.id && matchesDraft(item));
        } else {
          const created = latest.filter((item) => !initialProjectIds.current.has(item.id) && matchesDraft(item));
          if (created.length === 1) saved = created[0];
        }
        if (saved && mounted.current) {
          if(!baseProject)onCreateRecheckChange?.(null);
          invalidateProjectViews(client);
          toast.success(baseProject ? "已核对最新状态：项目设置已保存" : "已核对最新状态：项目已创建");
          onClose();
        }
      } catch {
        // 保留原写入错误和草稿，允许用户刷新后再确认。
      }
    },
    onSettled: () => { submitting.current = false; },
  });
  const checkCreatedProject=async()=>{if(!createRecheck||checkingCreate)return;setCheckingCreate(true);setCreateCheckError('');try{const latest=await api<Project[]>('/api/projects',{readOnly:true});client.setQueryData(keys.projects,latest);const baseline=new Set(createRecheck.baselineIds),draft=createRecheck.draft,created=latest.filter(item=>!baseline.has(item.id)&&item.name===canonicalizeLabel(draft.name)&&item.status===draft.status&&item.plannedStart===(draft.plannedStart||null)&&item.plannedEnd===(draft.plannedEnd||null)&&!item.isSample);if(created.length===1){onCreateRecheckChange?.(null);invalidateProjectViews(client);toast.success('已核对最新状态：项目已创建');onClose();return;}if(created.length===0){onCreateRecheckChange?.(null);mutation.reset();setCreateCheckError('未发现本次新增项目，已恢复原输入，可以重新提交。');return;}setCreateCheckError('发现多个可能的新项目，暂不解除锁定，请核对项目中心和操作记录。');}catch(error){setCreateCheckError(error instanceof Error?error.message:'项目列表读取失败');}finally{setCheckingCreate(false);}};
  return (
    <Modal title={project ? "编辑项目" : "新建项目"} closable={!mutation.isPending} onClose={() => { if (!submitting.current) onClose(); }}>
    {!templatesReady && templatesQuery.error ? <EmptyState title="项目配置加载失败" detail={templatesQuery.error.message || "暂时无法读取默认流程，请稍后重试。"} action={<Button variant="secondary" type="button" className="ghost-button" disabled={templatesQuery.isFetching} onClick={() => void templatesQuery.refetch()}>重新加载</Button>} />
      : !templatesReady ? <LoadingState label="正在加载项目配置…" className="stable-panel-state" /> : <>
    {templatesQuery.error && <div className="warning-banner">默认流程刷新失败，当前展示的是上次成功结果。<Button variant="secondary" type="button" className="ghost-button" disabled={templatesQuery.isFetching} onClick={() => void templatesQuery.refetch()}>重新加载</Button></div>}
    {changed && project && <div className="warning-banner">项目设置已在其他位置更新，当前草稿保持不变。<Button variant="secondary" type="button" className="ghost-button" disabled={mutation.isPending} onClick={() => {
      setBaseProject(project); setGuestVisible(Boolean(project.guestVisible)); setName(project.name); setStatus(project.status); setPlannedStart(project.plannedStart || ""); setPlannedEnd(project.plannedEnd || ""); setDefaultTemplateId(project.defaultTemplateId || ""); mutation.reset();
    }}>使用最新设置</Button></div>}
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || createUnknown || changed || selectedTemplateUnavailable) return;
        submitting.current = true;
        mutation.mutate({ name, status, plannedStart, plannedEnd, ...(baseProject ? { defaultTemplateId, guestVisible, expectedUpdatedAt: baseProject.updatedAt } : {}) });
      }}
    >
      <fieldset className="form-grid form-fieldset" disabled={mutation.isPending}>
      <FormField label="项目名称" full>
        <input name="name" value={name} onChange={(event) => setName(event.target.value)} required autoFocus placeholder="例如：DCIM平台 V1.0" />
      </FormField>
      <FormField label="项目状态" full help="状态只标识当前阶段；需要从日常页面隐藏时请使用项目归档。">
        <select name="status" value={status} onChange={(event) => setStatus(event.target.value)}>
          {projectStatusOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
        </select>
      </FormField>
      <FormField label="计划开始">
        <input name="plannedStart" type="date" max={plannedEnd || undefined} value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} />
      </FormField>
      <FormField label="计划完成">
        <input name="plannedEnd" type="date" min={plannedStart || undefined} value={plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)} />
      </FormField>
      {project && <FormField label="游客浏览" full asLabel={false} help="开放后，无需登录即可查看项目空间、对象说明和关联链接。问题、个人事务和管理功能仍需授权。">
        <label className="checkbox-label"><input type="checkbox" checked={guestVisible} onChange={event => setGuestVisible(event.target.checked)}/><span>允许游客查看</span></label>
      </FormField>}
      <FormField label="默认流程" full>
        <select name="defaultTemplateId" value={defaultTemplateId} onChange={(event) => setDefaultTemplateId(event.target.value)}>
          <option value="">不指定</option>
          {defaultTemplateId && !templates.some((template) => template.id === defaultTemplateId) && <option value={defaultTemplateId}>已不可用的流程（请重新选择）</option>}
          {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
        </select>
      </FormField>
      {selectedTemplateUnavailable && <FormError>所选默认流程已不可用，请重新选择。</FormError>}
      <FormError>{mutation.error?.message}</FormError>
      {createUnknown&&<FormError>创建结果待核对。本页面不会重复创建，请读取最新项目。</FormError>}
      {createCheckError&&<FormError>{createCheckError}</FormError>}
      {createUnknown&&<div className="field-full"><Button busy={(checkingCreate)} aria-label={checkingCreate?'读取中…':'读取最新项目并继续'} variant="secondary" type="button" className="ghost-button" disabled={checkingCreate} onClick={()=>void checkCreatedProject()}>{'读取最新项目并继续'}</Button></div>}
      <FormSubmitActions submitLabel={project ? "保存修改" : "创建项目"} pending={mutation.isPending} disabled={createUnknown || checkingCreate || changed || selectedTemplateUnavailable} onCancel={onClose} />
      </fieldset>
    </form>
    </>}
    </Modal>
  );
}

export function RequirementForm({
  projectId, defaultFeatureId, defaultPhaseId,
  initialRequirementIds,
  recheck,
  onRecheckChange,
  onClose,
}: {
  projectId: string;
  defaultFeatureId?:string;defaultPhaseId?:string;
  initialRequirementIds:string[];
  recheck:RequirementCreateRecheck|null;
  onRecheckChange:(value:RequirementCreateRecheck|null)=>void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast=useToast(),{session}=useSession();
  const submitting = useRef(false);
  const [local,setLocal,clearLocal]=useDeliveryForm<RequirementFormInput>(projectId,'new-requirement:'+ (defaultPhaseId||defaultFeatureId||'project'),()=>recheck?.draft||{projectId,title:'',ownerId:'',background:'',acceptanceCriteria:'',referenceUrl:'',featureId:defaultFeatureId,phaseId:defaultPhaseId},!!recheck);
  const initial=recheck?.draft||local;
  const unknown=Boolean(recheck);
  const [checking,setChecking]=useState(false),[checkError,setCheckError]=useState('');
  const [scheduleMode, setScheduleMode] = useState<"start" | "deadline">(initial?.plannedEnd&&!initial.plannedStart?"deadline":"start");
  const [scheduleDate, setScheduleDate] = useState(initial?.plannedEnd||initial?.plannedStart||"");
  const [title,setTitle]=useState(initial?.title||''),[featureId,setFeatureId]=useState(initial?.featureId||defaultFeatureId||''),[phaseId,setPhaseId]=useState(initial?.phaseId||defaultPhaseId||''),[placementReason,setPlacementReason]=useState(initial?.reason||''),[ownerId, setOwnerId] = useState(initial?.ownerId||""),[templateId, setTemplateId] = useState(initial?.templateId||"");
  const [background,setBackground]=useState(initial?.background||''),[acceptanceCriteria,setAcceptanceCriteria]=useState(initial?.acceptanceCriteria||''),[referenceLinks,setReferenceLinks]=useState(()=>readReferenceLinks(initial?.referenceLinks,initial?.referenceUrl));
  const referenceUrl=initial?.referenceUrl||'';
  useEffect(()=>setLocal({projectId,title,ownerId,background,acceptanceCriteria,referenceUrl,referenceLinks,featureId,phaseId,reason:placementReason,templateId,...scheduleDate?(scheduleMode==='start'?{plannedStart:scheduleDate}:{plannedEnd:scheduleDate}):{}}),[projectId,title,ownerId,background,acceptanceCriteria,referenceUrl,referenceLinks,featureId,phaseId,placementReason,templateId,scheduleDate,scheduleMode,setLocal]);
  const templatesQuery = useQuery({
    queryKey: [...keys.templates, projectId],
    queryFn: ({ signal }) => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(projectId)}`, { signal }),
    enabled: Boolean(projectId),
  });
  const peopleQuery = useQuery({
    queryKey: [...keys.people, projectId],
    queryFn: ({ signal }) => api<Person[]>(`/api/people?projectId=${encodeURIComponent(projectId)}`, { signal }),
    enabled: Boolean(projectId),
  });
  const templates = templatesQuery.data || [];
  const people = peopleQuery.data || [];
  const mutation = useMutation({
    mutationFn: async (data: RequirementFormInput) => {await assertCleanProjectDraft(session.accountId||'guest',projectId,data.phaseId?{requirementId:'',phaseId:data.phaseId,action:'phase'}:undefined);return api<Requirement>("/api/requirements", { method: "POST", body: jsonBody(data) });},
    onMutate:data=>onRecheckChange({draft:data,baselineIds:recheck?.baselineIds||initialRequirementIds}),
    onSuccess: () => {
      onRecheckChange(null);
      invalidateRequirementViews(client);
      clearLocal();onClose();
    },
    onError: error=>{if(!isWriteOutcomeUnknown(error))onRecheckChange(null);},
    onSettled: () => { submitting.current = false; },
  });
  const matchesDraft=(item:Requirement,draft:RequirementFormInput)=>item.projectId===projectId&&item.title===canonicalizeLabel(draft.title)&&item.ownerId===(draft.ownerId||null)&&item.background===(draft.background.trim()||null)&&item.acceptanceCriteria===(draft.acceptanceCriteria.trim()||null)&&(draft.referenceLinks!==undefined?JSON.stringify(readReferenceLinks(item.referenceLinks))===JSON.stringify(readReferenceLinks(draft.referenceLinks)):item.referenceUrl===(draft.referenceUrl.trim()||null))&&(!draft.featureId||item.featureId===draft.featureId)&&(item.phaseId||null)===(draft.phaseId||null)&&(!draft.templateId||item.templateId===draft.templateId)&&(!draft.plannedStart||item.plannedStart===draft.plannedStart)&&(!draft.plannedEnd||item.plannedEnd===draft.plannedEnd);
  const checkLatest=async()=>{if(!recheck||checking)return;setChecking(true);setCheckError('');try{const latest=await api<Requirement[]>(`/api/requirements?projectId=${encodeURIComponent(projectId)}`,{readOnly:true});client.setQueryData([...keys.requirements,projectId],latest);const baseline=new Set(recheck.baselineIds),created=latest.filter(item=>!baseline.has(item.id)&&matchesDraft(item,recheck.draft));if(created.length===1){onRecheckChange(null);invalidateRequirementViews(client,created[0].id);toast.success('已核对最新状态：需求已创建');clearLocal();onClose();return;}if(created.length===0){onRecheckChange(null);mutation.reset();setCheckError('未发现本次新增需求，已恢复原输入，可以重新提交。');return;}setCheckError('发现多个可能的新需求，暂不解除锁定，请核对需求列表和操作记录。');}catch(error){setCheckError(error instanceof Error?error.message:'需求列表读取失败');}finally{setChecking(false);}};
  return (
    <Modal title="新建需求" closable={!mutation.isPending} onClose={() => { if (!submitting.current) onClose(); }}>
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current||unknown) return;
        submitting.current = true;
        mutation.mutate({title,ownerId,background,acceptanceCriteria,referenceUrl,referenceLinks,featureId:featureId||null,phaseId:phaseId||null,reason:placementReason||undefined,templateId:templateId||undefined,projectId,...(scheduleDate?(scheduleMode==='start'?{plannedStart:scheduleDate}:{plannedEnd:scheduleDate}):{})});
      }}
    >
      <fieldset className="form-grid form-fieldset" disabled={mutation.isPending}>
      <FormField label="需求标题" full>
        <input name="title" value={title} onChange={event=>setTitle(event.target.value)} required autoFocus />
      </FormField>
      <OrganizationFields projectId={projectId} featureId={featureId} phaseId={phaseId} onChange={(key,value)=>{if(key==='featureId'){setFeatureId(value);setPhaseId('');}else setPhaseId(value);}}/>{phaseId&&<FormField label="安排原因（Phase 已推进时必填）" full><textarea maxLength={2000} value={placementReason} onChange={e=>setPlacementReason(e.target.value)}/></FormField>}
      <FormField label="需求负责人（可稍后指定）">
        <select name="ownerId" value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
          <option value="">待指定</option>
          {ownerId && !people.some((person) => person.id === ownerId && isAssignablePerson(person)) && <option value={ownerId}>已不可用的负责人（请重新选择）</option>}
          {people.filter(isAssignablePerson).map((person) => <option key={person.id} value={person.id}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</option>)}
        </select>
      </FormField>
      <FormDisclosure label="流程与排期" hint={templateId?'已选流程：'+(templates.find(t=>t.id===templateId)?.name||'项目默认流程'):'未选流程，直接执行；可稍后拆分'}>
        <FormField label="流程设计" full>
          <select name="templateId" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">暂不选择流程</option>
            {templateId && !templates.some((template) => template.id === templateId) && <option value={templateId}>{templatesQuery.data === undefined ? "项目默认流程（正在加载）" : "已不可用的流程（请重新选择）"}</option>}
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </FormField>
        <div className="field field-full">
          <span>排期方式</span>
          <div className="schedule-mode-switch" role="radiogroup" aria-label="排期方式">
          <button
            type="button"
            className={scheduleMode === "start" ? "is-active" : ""}
            role="radio"
            aria-checked={scheduleMode === "start"}
            onClick={() => { setScheduleMode("start"); setScheduleDate(""); }}
          >
            <strong>按开始日期排期</strong>
            <small>从选定日期按流程正向生成计划</small>
          </button>
          <button
            type="button"
            className={scheduleMode === "deadline" ? "is-active" : ""}
            role="radio"
            aria-checked={scheduleMode === "deadline"}
            onClick={() => { setScheduleMode("deadline"); setScheduleDate(""); }}
          >
            <strong>按截止日期倒排</strong>
            <small>以选定日期为目标反算计划开始</small>
          </button>
          </div>
        </div>
        <FormField label={scheduleMode === "start" ? "计划开始" : "截止日期"} full className="schedule-date-field">
          <input key={scheduleMode} name={scheduleMode === "start" ? "plannedStart" : "plannedEnd"} type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
        </FormField>
        <>{hasWorkdayCalendarFallback([scheduleDate])&&<p role="status" className="field-help field-full">该日期超出当前法定工作日日历覆盖范围，将按周一至周五计算。</p>}</>
        <p className="field-help field-full">不选流程时直接执行；选定流程后生成工作项。日期可留空，后续再预览排期。{scheduleMode === "deadline" ? " 截止日期需为工作日。" : ""}</p>
      </FormDisclosure>
      {(templatesQuery.error || peopleQuery.error) && <div className="warning-banner field-full">部分辅助选项加载失败，仍可创建直接执行需求并稍后补充。<Button variant="secondary" type="button" className="ghost-button" disabled={templatesQuery.isFetching || peopleQuery.isFetching} onClick={() => void Promise.all([templatesQuery.refetch(), peopleQuery.refetch()])}>重新加载</Button></div>}
      <FormDisclosure label="补充信息" hint="可选：背景、完成标准和参考链接">
        <FormField label="需求背景" full><textarea name="background" rows={3} value={background} onChange={event=>setBackground(event.target.value)} placeholder="为什么要做，可留空" /></FormField>
        <FormField label="完成标准" full><textarea name="acceptanceCriteria" rows={3} value={acceptanceCriteria} onChange={event=>setAcceptanceCriteria(event.target.value)} placeholder="如何判断完成，可留空" /></FormField>
        <ReferenceLinksEditor value={referenceLinks} onChange={setReferenceLinks}/>
      </FormDisclosure>
      <FormError>{mutation.error?.message}</FormError>
      {unknown&&<FormError>创建结果待核对，输入已保留。本页面不会重复创建，请读取最新需求。</FormError>}
      {checkError&&<FormError>{checkError}</FormError>}
      {unknown&&<div className="field-full"><Button busy={(checking)} aria-label={checking?'读取中…':'读取最新需求并继续'} variant="secondary" type="button" className="ghost-button" disabled={checking} onClick={()=>void checkLatest()}>{'读取最新需求并继续'}</Button></div>}
      <FormSubmitActions disabled={unknown||checking} submitLabel="创建需求" pending={mutation.isPending} onCancel={()=>{clearLocal();onClose();}} />
      </fieldset>
    </form>
    </Modal>
  );
}
