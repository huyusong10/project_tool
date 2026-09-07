import { useRef, useState } from "react";
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Edit3, Plus } from "lucide-react";
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateTemplateViews, keys } from "../query-keys";
import type { Archives, WorkItemTemplate } from "../types";
import { ConfirmDialog } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { canManageProject } from "../permissions";
import { TemplateForm } from "../components/TemplateForm";
import { EmptyState } from "../components/Feedback";

const emptyTemplates: WorkItemTemplate[] = [];

export function TemplatesPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const client = useQueryClient();
  const [params,setParams]=useSearchParams();
  const [editingSnapshot,setEditingSnapshot]=useState<WorkItemTemplate|null>(null);
  const setEditing=(value:WorkItemTemplate|null|undefined)=>{setEditingSnapshot(value||null);const next=new URLSearchParams(params);next.delete('templateNode');if(value===undefined)next.delete('edit');else next.set('edit',value?.id||'new');setParams(next);};
  const [archiveTarget, setArchiveTarget] = useState<WorkItemTemplate | null>(null);
  const [archiveNeedsReopen, setArchiveNeedsReopen] = useState(false);
  const archiveSubmitting = useRef(false);
  const { data: loadedTemplates, error, refetch, isFetching, isLoading } = useQuery({
    queryKey: [...keys.templates, selectedProjectId],
    queryFn: ({ signal }) => api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(selectedProjectId)}`, { signal }),
    enabled: Boolean(selectedProjectId),
  });
  const data = loadedTemplates || emptyTemplates;
  const editing=params.get('edit')==='new'?null:params.get('edit')?(data.find(t=>t.id===params.get('edit'))||editingSnapshot||undefined):undefined;
  const listUnavailable = Boolean(error && !loadedTemplates);
  const canManage = canManageProject(session, selectedProjectId);
  const project = projects.find((item) => item.id === selectedProjectId);
  const archive = useMutation({
    mutationFn: (template: WorkItemTemplate) =>
      api(`/api/templates/${template.id}`, { method: "DELETE", body: jsonBody({ expectedUpdatedAt: template.updatedAt }) }),
    onSuccess: () => {
      setArchiveTarget(null);
      setArchiveNeedsReopen(false);
      invalidateTemplateViews(client, true);
    },
    onError: async (caught, template) => {
      if (isWriteOutcomeUnknown(caught)) {
        try {
          const [latestTemplates, latestArchives] = await Promise.all([
            api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(selectedProjectId)}`, { readOnly: true }),
            api<Archives>(`/api/archives?projectId=${encodeURIComponent(selectedProjectId)}`, { readOnly: true }),
          ]);
          client.setQueryData([...keys.templates, selectedProjectId], latestTemplates);
          client.setQueryData([...keys.projectArchives, selectedProjectId], latestArchives);
          if (!latestTemplates.some((entry) => entry.id === template.id)
            && latestArchives.templates.some((entry) => entry.id === template.id)) {
            setArchiveTarget(null);
            setArchiveNeedsReopen(false);
            invalidateTemplateViews(client, true);
            return;
          }
        } catch {
          // 保留原始写入异常；活动列表与归档列表必须同时读回才能确认归档成功。
        }
      }
      if (!requiresWriteRecheck(caught)) return;
      setArchiveNeedsReopen(true);
      invalidateTemplateViews(client, true);
      void client.invalidateQueries({ queryKey: keys.projects });
    },
    onSettled: () => { archiveSubmitting.current = false; },
  });
  const submitArchive = (template: WorkItemTemplate) => {
    if (archiveSubmitting.current) return;
    archiveSubmitting.current = true;
    archive.mutate(template);
  };
  if (editing !== undefined && canManage) return <><PageHeader title="流程设计"/><TemplateForm key={selectedProjectId+':'+(editing?.id||'new')}
    template={editing ? data.find(t=>t.id===editing.id)||editing : undefined} templateUnavailable={Boolean(editing&&loadedTemplates&&!data.some(t=>t.id===editing.id))}
    projectId={selectedProjectId} onClose={()=>setEditing(undefined)}/></>;
  return (
    <>
      <PageHeader
        title="流程设计"
        actions={canManage ? (
          <button className="primary-button" onClick={() => setEditing(null)}>
            <Plus size={16} />
            新建流程
          </button>
        ) : null}
      />
      <div className="page-content">
        {error && loadedTemplates && <div className="warning-banner">流程列表刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
        {listUnavailable ? <EmptyState title="流程列表加载失败" detail={error?.message || "暂时无法读取流程设计。"} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} /> : <>
        <section className="template-grid">
        {data.map((template) => (
          <article className="template-card" key={template.id}>
            <header>
              <div>
                <strong className="template-name-line">{template.name}{project?.defaultTemplateId === template.id && <span className="template-default-badge">项目默认</span>}</strong>
                <small>{template.items.length}个工作项 · {template.items.filter((item) => item.milestoneLabel).length}个里程碑</small>
              </div>
              {canManage && (
                <div className="row-actions">
                  <button aria-label={`编辑流程 ${template.name}`} onClick={() => setEditing(template)}>
                    <Edit3 size={15} />
                  </button>
                  <button
                    aria-label={`归档流程 ${template.name}`}
                    onClick={() => { archive.reset(); setArchiveNeedsReopen(false); setArchiveTarget(template); }}
                  >
                    <Archive size={15} />
                  </button>
                </div>
              )}
            </header>
            {template.description && <p className="template-description" title={template.description}>{template.description}</p>}
            <ol>
              {template.items.map((item) => (
                <li key={item.id}>
                  <span>{item.sortOrder + 1}</span>
                  <div><b>{item.title}</b><small>第{item.startOffsetDays + 1}个工作日 · 持续{item.durationDays}个工作日{item.milestoneLabel && <em>◆ {item.milestoneLabel}</em>}</small></div>
                </li>
              ))}
            </ol>
          </article>
        ))}
        </section>
        {!data.length && !isLoading && <EmptyState title="还没有流程" detail="新建流程后可以用于需求排期。" />}
        {editing !== undefined && (
          <TemplateForm
            template={editing ? data.find((template) => template.id === editing.id) || editing : undefined}
            templateUnavailable={Boolean(editing && loadedTemplates && !data.some((template) => template.id === editing.id))}
            projectId={selectedProjectId}
            onClose={() => setEditing(undefined)}
          />
        )}
        {archiveTarget && (() => {
          const currentTarget = data.find((template) => template.id === archiveTarget.id);
          const targetUnavailable = loadedTemplates !== undefined && !currentTarget;
          const targetChanged = Boolean(currentTarget && currentTarget.updatedAt !== archiveTarget.updatedAt);
          const refreshReason = targetUnavailable
            ? "流程已不在当前列表，请关闭窗口后刷新确认。"
            : targetChanged || archiveNeedsReopen
              ? "流程或归档条件已更新，请关闭窗口后重新选择归档。"
              : undefined;
          const blockedReason = project?.defaultTemplateId === archiveTarget.id
            ? "这是项目默认流程。请先在项目设置中更换默认流程，再执行归档。"
            : data.length <= 1 ? "项目至少需要保留一个有效流程，当前流程不能归档。" : undefined;
          const disabledReason = refreshReason || blockedReason;
          return <ConfirmDialog title="归档流程" description={<>流程“<strong>{archiveTarget.name}</strong>”归档后不再用于新需求，已有需求和历史数据不会改变。</>} confirmLabel={disabledReason ? "无法归档" : "确认归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(disabledReason)} error={disabledReason || archive.error?.message} onClose={() => { setArchiveTarget(null); setArchiveNeedsReopen(false); }} onConfirm={() => submitArchive(archiveTarget)} />;
        })()}
        </>}
      </div>
    </>
  );
}
