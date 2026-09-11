import {useAppSearchParams} from '../use-app-navigation';
import {usePageResources} from '../page-context';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { usePageScrollPosition } from '../use-page-view';
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Edit3, Plus, Diamond } from "lucide-react";
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateTemplateViews, keys } from "../query-keys";
import type { Archives, WorkItemTemplate } from "../types";
import { ConfirmDialog, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { canManageProject } from "../permissions";
import { TemplateForm } from "../components/TemplateForm";
import { EmptyState } from "../components/Feedback";
import { templateOverview } from '../template-overview';
import { TemplateOverview, TemplateStats } from '../components/TemplateOverview';
import '../components/template-overview.css';

const emptyTemplates: WorkItemTemplate[] = [];
function templateArchiveRecheckKey(accountKey:string,projectId:string){return `project-manage:template-archive-recheck:${accountKey}:${projectId}`;}
function readTemplateArchiveRecheck(accountKey:string,projectId:string):WorkItemTemplate|null{try{const raw=sessionStorage.getItem(templateArchiveRecheckKey(accountKey,projectId));if(!raw)return null;const value=JSON.parse(raw) as Partial<WorkItemTemplate>;return value.projectId===projectId&&typeof value.id==='string'&&typeof value.name==='string'&&typeof value.updatedAt==='string'&&Array.isArray(value.items)?value as WorkItemTemplate:null;}catch{return null;}}
function persistTemplateArchiveRecheck(accountKey:string,projectId:string,value:WorkItemTemplate|null){try{const key=templateArchiveRecheckKey(accountKey,projectId);if(value)sessionStorage.setItem(key,JSON.stringify(value));else sessionStorage.removeItem(key);}catch{/* 当前页面仍保留核对锁。 */}}

function TemplateCard({ template, isDefault, canManage, archiveDisabled, onPreview, onEdit, onArchive }: {
  template: WorkItemTemplate; isDefault: boolean; canManage: boolean; archiveDisabled: boolean;
  onPreview: () => void; onEdit: () => void; onArchive: () => void;
}) {
  const overview = useMemo(() => templateOverview(template), [template]);
  const purpose = template.description?.trim().split(/(?<=[。！？])|\n/)[0] || '暂无用途说明';
  return <article className="template-card">
    <header><strong className="template-name-line"><button type="button" className="template-name-button" onClick={onPreview}>{template.name}</button>{isDefault && <span className="template-default-badge">项目默认</span>}</strong></header>
    <p className="template-purpose" title={template.description}>{purpose}</p>
    <TemplateStats overview={overview} />
    <TemplateOverview overview={overview} />
    <footer className="template-card-actions">
      <button type="button" className="ghost-button" aria-label={`查看流程 ${template.name}`} onClick={onPreview}>查看详情</button>
      {canManage && <><button type="button" className="ghost-button" aria-label={`编辑流程 ${template.name}`} onClick={onEdit}><Edit3 size={14} />编辑</button><button type="button" className="icon-button template-archive-button" title="归档流程" aria-label={`归档流程 ${template.name}`} disabled={archiveDisabled} onClick={onArchive}><Archive size={15} /></button></>}
    </footer>
  </article>;
}

function TemplatePreview({ template, onEdit }: { template: WorkItemTemplate; onEdit?: () => void }) {
  const overview = useMemo(() => templateOverview(template), [template]);
  const titles = new Map(overview.nodes.map(item => [item.id, item.title]));
  return <div className="template-preview">
    <div className="template-preview-heading"><h3>{template.name}</h3>{onEdit && <button type="button" className="primary-button" onClick={onEdit}><Edit3 size={14} />编辑流程</button>}</div>
    <TemplateStats overview={overview} />
    <p className="template-preview-description">{template.description || '暂无用途说明'}</p>
    <ol className="template-preview-items" aria-label="工作项与里程碑详情">{overview.nodes.map(item => <li key={item.id}>
      <strong>{item.kind === 'milestone' && <Diamond size={14} />}{item.title}</strong>
      <p>{item.kind === 'milestone' ? `${item.startOffsetDays ? `第 ${item.startOffsetDays} 个工作日结束` : '流程开始时'} · 里程碑${item.confirmationMode === 'manual' ? ' · 手动确认' : ''}` : `第 ${item.startOffsetDays + 1}—${item.startOffsetDays + item.durationDays} 个工作日 · 持续 ${item.durationDays} 个工作日`}</p>
      <p>{item.predecessorIds?.length ? `前置：${item.predecessorIds.map(id => titles.get(id) || '未找到的工作项').join('、')}` : overview.dependencies ? '无前置依赖' : '未设置依赖'}</p>
    </li>)}</ol>
  </div>;
}

export function TemplatesPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const client = useQueryClient();
  const recheckAccountKey=session.accountId||session.username||'guest';
  const [params,setParams]=useAppSearchParams();
  const [editingSnapshot,setEditingSnapshot]=useState<WorkItemTemplate|null>(null);
  const [preview, setPreview] = useState<WorkItemTemplate | null>(null);
  const setEditing=(value:WorkItemTemplate|null|undefined)=>{setEditingSnapshot(value||null);const next=new URLSearchParams(params);next.set('projectId',selectedProjectId);next.delete('templateNode');if(value)next.delete('draft');if(value===undefined)next.delete('edit');else next.set('edit',value?.id||'new');setParams(next);};
  const [archiveTarget, setArchiveTarget] = useState<WorkItemTemplate | null>(null);
  const [archiveRecheck,setArchiveRecheckState]=useState<WorkItemTemplate|null>(()=>readTemplateArchiveRecheck(recheckAccountKey,selectedProjectId));
  const [archiveRechecking,setArchiveRechecking]=useState(false),archiveNeedsReopen=Boolean(archiveRecheck);
  const setArchiveRecheck=(value:WorkItemTemplate|null)=>{persistTemplateArchiveRecheck(recheckAccountKey,selectedProjectId,value);setArchiveRecheckState(value);};
  useEffect(()=>{setArchiveRecheckState(readTemplateArchiveRecheck(recheckAccountKey,selectedProjectId));setArchiveTarget(null);setPreview(null);},[recheckAccountKey,selectedProjectId]);
  const archiveSubmitting = useRef(false);
  const {data: loadedTemplates, error, refetch, isFetching, isLoading} = usePageResources().templates;
  const data = loadedTemplates || emptyTemplates;
  const editing=params.get('edit')==='new'?null:params.get('edit')?(data.find(t=>t.id===params.get('edit'))||editingSnapshot||undefined):undefined;
  const pagination = useListPagination({ items: data, ready: Boolean(loadedTemplates), loading: isFetching });
  usePageScrollPosition(Boolean(loadedTemplates));
  const listUnavailable = Boolean(error && !loadedTemplates);
  const canManage = canManageProject(session, selectedProjectId);
  const project = projects.find((item) => item.id === selectedProjectId);
  const previewTemplate = preview && (data.find(item => item.id === preview.id) || preview);
  const archive = useMutation({
    mutationFn: (template: WorkItemTemplate) =>
      api(`/api/templates/${template.id}`, { method: "DELETE", body: jsonBody({ expectedUpdatedAt: template.updatedAt }) }),
    onMutate:template=>setArchiveRecheck(template),
    onSuccess: () => {
      setArchiveTarget(null);
      setArchiveRecheck(null);
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
            setArchiveRecheck(null);
            invalidateTemplateViews(client, true);
            return;
          }
        } catch {
          // 保留原始写入异常；活动列表与归档列表必须同时读回才能确认归档成功。
        }
      }
      if (!requiresWriteRecheck(caught)){setArchiveRecheck(null);return;}
      setArchiveRecheck(template);
      invalidateTemplateViews(client, true);
      void client.invalidateQueries({ queryKey: keys.projects });
    },
    onSettled: () => { archiveSubmitting.current = false; },
  });
  const submitArchive = (template: WorkItemTemplate) => {
    if (archiveSubmitting.current||archiveRecheck) return;
    archiveSubmitting.current = true;
    archive.mutate(template);
  };
  const recheckTemplateArchive=async()=>{if(!archiveRecheck||archiveRechecking)return;setArchiveRechecking(true);try{const [latestTemplates,latestArchives]=await Promise.all([api<WorkItemTemplate[]>(`/api/templates?projectId=${encodeURIComponent(selectedProjectId)}`,{readOnly:true}),api<Archives>(`/api/archives?projectId=${encodeURIComponent(selectedProjectId)}`,{readOnly:true})]);client.setQueryData([...keys.templates,selectedProjectId],latestTemplates);client.setQueryData([...keys.projectArchives,selectedProjectId],latestArchives);const active=latestTemplates.some(item=>item.id===archiveRecheck.id),archived=latestArchives.templates.some(item=>item.id===archiveRecheck.id);if(active!==archived){setArchiveRecheck(null);setArchiveTarget(null);invalidateTemplateViews(client,true);}}catch{/* 两份权威列表必须同时读取成功。 */}finally{setArchiveRechecking(false);}};
  if (editing !== undefined && canManage) return <><TemplateForm key={selectedProjectId+':'+(editing?.id||'new')}
    template={editing ? data.find(t=>t.id===editing.id)||editing : undefined} templateUnavailable={Boolean(editing&&loadedTemplates&&!data.some(t=>t.id===editing.id))}
    projectId={selectedProjectId} onClose={()=>setEditing(undefined)} onSaved={(value,node)=>{setEditingSnapshot(value);const p=new URLSearchParams(params);p.set('edit',value.id);p.delete('draft');if(node)p.set('templateNode',node);setParams(p,{replace:true});}}/></>;
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
        {archiveRecheck&&<div role="alert" className="warning-banner">“{archiveRecheck.name}”的流程归档结果待核对，其他归档操作暂不可用。<button type="button" className="ghost-button" disabled={archiveRechecking} onClick={()=>void recheckTemplateArchive()}>{archiveRechecking?'读取中…':'重新读取流程与归档'}</button></div>}
        {error && loadedTemplates && <div className="warning-banner">流程列表刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
        {listUnavailable ? <EmptyState title="流程列表加载失败" detail={error?.message || "暂时无法读取流程设计。"} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} /> : <>
        <section className="panel paged-panel template-catalog"><div className="paged-body" ref={pagination.scrollRef}><div className="template-grid">
        {pagination.items.map(template => <TemplateCard key={template.id} template={template} isDefault={project?.defaultTemplateId === template.id} canManage={canManage} archiveDisabled={Boolean(archiveRecheck)} onPreview={() => setPreview(template)} onEdit={() => setEditing(template)} onArchive={() => { if (!archiveRecheck) { archive.reset(); setArchiveTarget(template); } }} />)}
        </div></div><Pagination {...pagination.props} label="流程列表分页" /></section>
        {previewTemplate && <Modal title="流程详情" width={640} placement="right" onClose={() => setPreview(null)}><TemplatePreview template={previewTemplate} onEdit={canManage && data.some(item => item.id === previewTemplate.id) ? () => { setPreview(null); setEditing(previewTemplate); } : undefined} /></Modal>}
        {!data.length && !isLoading && <EmptyState title="还没有流程" detail="新建流程后可以用于需求排期。" />}
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
          return <ConfirmDialog title="归档流程" description={<>流程“<strong>{archiveTarget.name}</strong>”归档后不再用于新需求，已有需求和历史数据不会改变。</>} confirmLabel={disabledReason ? "无法归档" : "确认归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(disabledReason)} error={disabledReason || archive.error?.message} onClose={() => setArchiveTarget(null)} onConfirm={() => submitArchive(archiveTarget)} />;
        })()}
        </>}
      </div>
    </>
  );
}
