import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type { Project, WorkItemTemplate } from "../types";

export function ProjectForm({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<WorkItemTemplate[]>("/api/templates"),
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
      <label className="field field-full">
        <span>项目名称</span>
        <input name="name" defaultValue={project?.name || ""} required autoFocus placeholder="例如：DCIM平台 V1.0" />
      </label>
      <label className="field">
        <span>计划开始</span>
        <input name="plannedStart" type="date" defaultValue={project?.plannedStart || ""} />
      </label>
      <label className="field">
        <span>计划完成</span>
        <input name="plannedEnd" type="date" defaultValue={project?.plannedEnd || ""} />
      </label>
      <label className="field field-full">
        <span>默认工作项模板</span>
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
  const { projects } = useApp();
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => api<WorkItemTemplate[]>("/api/templates"),
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
        <span>工作项模板</span>
        <select key={`${projectId}-${templates.length}`} name="templateId" required defaultValue={defaultTemplateId}>
          {!defaultTemplateId && <option value="">请选择模板</option>}
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>计划开始</span>
        <input name="plannedStart" type="date" required />
      </label>
      <p className="field-help field-full">保存后将按模板自动生成工作项和计划完成日期。</p>
      {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
      <div className="form-actions field-full">
        <button type="button" className="ghost-button" onClick={onClose}>取消</button>
        <button className="primary-button" disabled={mutation.isPending}>创建需求</button>
      </div>
    </form>
  );
}
