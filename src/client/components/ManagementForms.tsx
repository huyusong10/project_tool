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

type ProjectFormInput = {
  name: string;
  status: string;
  plannedStart: string;
  plannedEnd: string;
  defaultTemplateId: string;
  expectedUpdatedAt?: string;
};

type RequirementFormInput = {
  groupId?:string|null;
  projectId: string;
  templateId?: string;
  title: string;
  ownerId: string;
  background: string;
  acceptanceCriteria: string;
  referenceUrl: string;
  plannedStart?: string;
  plannedEnd?: string;
};

export function ProjectForm({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const { projects } = useProjects();
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const initialProjectIds = useRef(new Set(projects.map((item) => item.id)));
  const [baseProject, setBaseProject] = useState(project);
  const [name, setName] = useState(project?.name || "");
  const [status, setStatus] = useState(project?.status || "active");
  const [plannedStart, setPlannedStart] = useState(project?.plannedStart || "");
  const [plannedEnd, setPlannedEnd] = useState(project?.plannedEnd || "");
  const [defaultTemplateId, setDefaultTemplateId] = useState(project?.defaultTemplateId || "");
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
    onSuccess: () => {
      invalidateProjectViews(client);
      onClose();
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await api<Project[]>("/api/projects", { readOnly: true });
        const matchesDraft = (item: Project) => item.name === canonicalizeLabel(input.name)
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
  return (
    <Modal title={project ? "编辑项目" : "新建项目"} closable={!mutation.isPending} onClose={() => { if (!submitting.current) onClose(); }}>
    {!templatesReady && templatesQuery.error ? <EmptyState title="项目配置加载失败" detail={templatesQuery.error.message || "暂时无法读取默认流程，请稍后重试。"} action={<button type="button" className="ghost-button" disabled={templatesQuery.isFetching} onClick={() => void templatesQuery.refetch()}>重新加载</button>} />
      : !templatesReady ? <LoadingState label="正在加载项目配置…" className="stable-panel-state" /> : <>
    {templatesQuery.error && <div className="warning-banner">默认流程刷新失败，当前展示的是上次成功结果。<button type="button" className="ghost-button" disabled={templatesQuery.isFetching} onClick={() => void templatesQuery.refetch()}>重新加载</button></div>}
    {changed && project && <div className="warning-banner">项目设置已在其他位置更新，当前草稿保持不变。<button type="button" className="ghost-button" disabled={mutation.isPending} onClick={() => {
      setBaseProject(project); setName(project.name); setStatus(project.status); setPlannedStart(project.plannedStart || ""); setPlannedEnd(project.plannedEnd || ""); setDefaultTemplateId(project.defaultTemplateId || ""); mutation.reset();
    }}>使用最新设置</button></div>}
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current || changed || selectedTemplateUnavailable) return;
        submitting.current = true;
        mutation.mutate({ name, status, plannedStart, plannedEnd, defaultTemplateId, ...(baseProject ? { expectedUpdatedAt: baseProject.updatedAt } : {}) });
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
      <FormField label="默认流程" full>
        <select name="defaultTemplateId" value={defaultTemplateId} onChange={(event) => setDefaultTemplateId(event.target.value)}>
          <option value="">不指定</option>
          {defaultTemplateId && !templates.some((template) => template.id === defaultTemplateId) && <option value={defaultTemplateId}>已不可用的流程（请重新选择）</option>}
          {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
        </select>
      </FormField>
      {selectedTemplateUnavailable && <FormError>所选默认流程已不可用，请重新选择。</FormError>}
      <FormError>{mutation.error?.message}</FormError>
      <FormSubmitActions submitLabel={project ? "保存修改" : "创建项目"} pending={mutation.isPending} disabled={changed || selectedTemplateUnavailable} onCancel={onClose} />
      </fieldset>
    </form>
    </>}
    </Modal>
  );
}

export function RequirementForm({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const submitting = useRef(false);
  const [unknown,setUnknown]=useState(false);
  const [scheduleMode, setScheduleMode] = useState<"start" | "deadline">("start");
  const [scheduleDate, setScheduleDate] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [templateId, setTemplateId] = useState("");
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
    mutationFn: (data: RequirementFormInput) => api<Requirement>("/api/requirements", { method: "POST", body: jsonBody(data) }),
    onSuccess: () => {
      invalidateRequirementViews(client);
      onClose();
    },
    onError: error=>{if(isWriteOutcomeUnknown(error))setUnknown(true);},
    onSettled: () => { submitting.current = false; },
  });
  return (
    <Modal title="新建需求" closable={!mutation.isPending} onClose={() => { if (!submitting.current) onClose(); }}>
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (submitting.current||unknown) return;
        submitting.current = true;
        const values = Object.fromEntries(new FormData(event.currentTarget));
        mutation.mutate({ ...values,title:String(values.title||''),ownerId,background:String(values.background||''),acceptanceCriteria:String(values.acceptanceCriteria||''),referenceUrl:String(values.referenceUrl||''),groupId:String(values.groupId||'')||null, templateId:templateId||undefined, projectId } as RequirementFormInput);
      }}
    >
      <fieldset className="form-grid form-fieldset" disabled={mutation.isPending}>
      <FormField label="需求标题" full>
        <input name="title" required autoFocus />
      </FormField>
      <OrganizationFields projectId={projectId}/>
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
      {(templatesQuery.error || peopleQuery.error) && <div className="warning-banner field-full">部分辅助选项加载失败，仍可创建直接执行需求并稍后补充。<button type="button" className="ghost-button" disabled={templatesQuery.isFetching || peopleQuery.isFetching} onClick={() => void Promise.all([templatesQuery.refetch(), peopleQuery.refetch()])}>重新加载</button></div>}
      <FormDisclosure label="补充信息" hint="可选：背景、完成标准和参考链接">
        <FormField label="需求背景" full><textarea name="background" rows={3} placeholder="为什么要做，可留空" /></FormField>
        <FormField label="完成标准" full><textarea name="acceptanceCriteria" rows={3} placeholder="如何判断完成，可留空" /></FormField>
        <FormField label="参考链接" full><input name="referenceUrl" type="url" placeholder="https://…" /></FormField>
      </FormDisclosure>
      <FormError>{mutation.error?.message}</FormError>
      {unknown&&<FormError>创建结果待核对，输入已保留。请检查需求列表和操作记录，本窗口不会重复创建。</FormError>}
      <FormSubmitActions disabled={unknown} submitLabel="创建需求" pending={mutation.isPending} onCancel={onClose} />
      </fieldset>
    </form>
    </Modal>
  );
}
