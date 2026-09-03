import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type { Person, Project, WorkItemTemplate } from "../types";
import { workdayCalendarWarning } from "../../shared/workday";

export function ProjectForm({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", project?.id || "new"],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(project!.id)}`),
    enabled: Boolean(project?.id),
  });
  const mutation = useMutation({
    mutationFn: (data: object) =>
      api(project ? `/api/projects/${project.id}` : "/api/projects", {
        method: project ? "PATCH" : "POST",
        body: jsonBody(data),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      {project && <label className="field field-full">
        <span>项目名称</span>
        <input name="name" defaultValue={project?.name || ""} required autoFocus placeholder="例如：DCIM平台 V1.0" />
      </label>}
      <label className="field">
        <span>计划开始</span>
        <input name="plannedStart" type="date" defaultValue={project?.plannedStart || ""} />
      </label>
      <label className="field">
        <span>计划完成</span>
        <input name="plannedEnd" type="date" defaultValue={project?.plannedEnd || ""} />
      </label>
      <label className="field field-full">
        <span>默认流程</span>
        <select key={`${project?.id || "new"}-${templates.length}`} name="defaultTemplateId" defaultValue={project?.defaultTemplateId || ""}>
          <option value="">不指定</option>
          {templates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}
        </select>
      </label>
      {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={mutation.isPending}>{project ? "保存修改" : "创建项目"}</button>
      </div>
    </form>
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
  const [scheduleMode, setScheduleMode] = useState<"start" | "deadline">("start");
  const [planningOpen, setPlanningOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const { projects } = useApp();
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", projectId],
    queryFn: () => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(projectId)}`),
    enabled: Boolean(projectId),
  });
  const { data: people = [] } = useQuery({
    queryKey: ["people", projectId],
    queryFn: () => api<Person[]>(`/api/people?projectId=${encodeURIComponent(projectId)}`),
    enabled: Boolean(projectId),
  });
  const mutation = useMutation({
    mutationFn: (data: object) => api("/api/requirements", { method: "POST", body: jsonBody(data) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirements"] });
      void client.invalidateQueries({ queryKey: ["dashboard"] });
      onClose();
    },
  });
  const defaultTemplateId = projects.find((project) => project.id === projectId)?.defaultTemplateId || "";
  return (
    <form
      className="form-grid"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate({ ...Object.fromEntries(new FormData(event.currentTarget)), projectId });
      }}
    >
      <label className="field field-full">
        <span>需求标题</span>
        <input name="title" required autoFocus />
      </label>
      <label className="field">
        <span>优先级</span>
        <select name="priority" defaultValue="P2">
          <option value="P0">P0 · 紧急</option>
          <option value="P1">P1 · 高</option>
          <option value="P2">P2 · 中</option>
          <option value="P3">P3 · 低</option>
        </select>
      </label>
      <label className="field">
        <span>需求负责人（可稍后指定）</span>
        <select name="ownerId" defaultValue="">
          <option value="">待指定</option>
          {people.filter((person) => person.active && person.projectRole !== "viewer").map((person) => <option key={person.id} value={person.id}>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</option>)}
        </select>
      </label>
      <div className="form-disclosure field-full">
        <button type="button" className={planningOpen ? "is-open" : ""} onClick={() => setPlanningOpen((value) => !value)}>
          <strong>立即规划</strong><span>{planningOpen ? "收起" : "可选：选择流程并自动生成工作项"}</span>
        </button>
      </div>
      {planningOpen && <>
        <label className="field field-full">
          <span>流程设计</span>
          <select key={`${projectId}-${templates.length}`} name="templateId" required defaultValue={defaultTemplateId}>
            {!defaultTemplateId && <option value="">请选择模板</option>}
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </select>
        </label>
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
        <label className="field field-full schedule-date-field">
          <span>{scheduleMode === "start" ? "计划开始" : "截止日期"}</span>
          <input key={scheduleMode} name={scheduleMode === "start" ? "plannedStart" : "plannedEnd"} type="date" required value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} />
        </label>
        {workdayCalendarWarning(scheduleDate, scheduleDate) && <p className="calendar-coverage-warning field-full">{workdayCalendarWarning(scheduleDate, scheduleDate)}</p>}
        <p className="field-help field-full">{scheduleMode === "start" ? "保存后按流程自动生成工作项并计算完成日期。" : "保存后按流程工期倒排；截止日期需为工作日。"}</p>
      </>}
      <div className="form-disclosure field-full">
        <button type="button" className={detailsOpen ? "is-open" : ""} onClick={() => setDetailsOpen((value) => !value)}>
          <strong>补充信息</strong><span>{detailsOpen ? "收起" : "可选：背景、验收标准和参考链接"}</span>
        </button>
      </div>
      {detailsOpen && <>
        <label className="field field-full"><span>需求背景</span><textarea name="background" rows={3} placeholder="为什么要做，可留空" /></label>
        <label className="field field-full"><span>验收标准</span><textarea name="acceptanceCriteria" rows={3} placeholder="如何判断完成，可留空" /></label>
        <label className="field field-full"><span>参考链接</span><input name="referenceUrl" type="url" placeholder="https://…" /></label>
      </>}
      {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={mutation.isPending}>创建需求</button>
      </div>
    </form>
  );
}
