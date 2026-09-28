import { readRecheck, persistRecheck } from '../core/write-recheck';
import * as templatesApi from '../features/templates/api';
import * as archivesApi from '../features/archives/api';
import { Button } from '../components/Button';
import { useAppSearchParams } from '../use-app-navigation';
import { usePageResources } from '../page-context';
import { usePageScrollPosition } from '../use-page-view';
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Copy, Edit3, Plus } from "lucide-react";
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateTemplateViews, keys } from "../query-keys";
import type { Archives, WorkItemTemplate } from "../types";
import { ConfirmDialog, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { canManageProject } from "../permissions";
import { createTemplateCopyDraft, TemplateForm } from "../components/TemplateForm";
import { EmptyState } from "../components/Feedback";
import { templateOverview } from '../template-overview';
import { TemplateThumbnail } from '../components/TemplateThumbnail';
import { TemplatePreview } from '../components/TemplatePreview';
import { TemplateReuseDialog } from '../components/TemplateReuseDialog';
import '../components/template-overview.css';

const emptyTemplates: WorkItemTemplate[] = [];
function templateArchiveRecheckKey(accountKey:string,projectId:string){return `project-manage:template-archive-recheck:${accountKey}:${projectId}`;}
function readTemplateArchiveRecheck(accountKey:string,projectId:string):WorkItemTemplate|null{
  return readRecheck(templateArchiveRecheckKey(accountKey,projectId), stored => {const value=stored as Partial<WorkItemTemplate>;return value.projectId===projectId&&typeof value.id==='string'&&typeof value.name==='string'&&typeof value.updatedAt==='string'&&Array.isArray(value.items)?value as WorkItemTemplate:null;
  });
}
function persistTemplateArchiveRecheck(accountKey:string,projectId:string,value:WorkItemTemplate|null){
  persistRecheck(templateArchiveRecheckKey(accountKey,projectId), value);
}

function TemplateCard({ template, isDefault, canManage, archiveDisabled, onPreview, onEdit, onArchive }: {
  template: WorkItemTemplate; isDefault: boolean; canManage: boolean; archiveDisabled: boolean;
  onPreview: () => void; onEdit: () => void; onArchive: () => void;
}) {
  const overview = useMemo(() => templateOverview(template), [template]);
  const purpose = template.description?.trim().split(/(?<=[。！？])|\n/)[0] || '暂无用途说明';
  return <article className="template-card">
    <header><div className="template-name-line"><button type="button" className="template-name-button" onClick={onPreview}>{template.name}</button>{isDefault && <span className="template-default-badge">项目默认</span>}<span className="template-card-summary">{overview.workCount} 项工作 · {overview.milestoneCount} 个里程碑 · {overview.span} 工作日</span></div>
      {canManage && <div className="template-card-actions"><Button variant="ghost" size="small" aria-label={`编辑流程 ${template.name}`} onClick={onEdit}><Edit3 size={14} />编辑</Button><Button variant="ghost" size="small" iconOnly title="归档流程" aria-label={`归档流程 ${template.name}`} disabled={archiveDisabled} onClick={onArchive}><Archive size={15} /></Button></div>}
    </header>
    <p className="template-purpose" title={template.description}>{purpose}</p>
    <TemplateThumbnail overview={overview} name={template.name} onOpen={onPreview} />
  </article>;
}

export function TemplatesPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const client = useQueryClient();
  const recheckAccountKey=session.accountId||session.username||'guest';
  const [params,setParams]=useAppSearchParams();
  const [editingSnapshot,setEditingSnapshot]=useState<WorkItemTemplate|null>(null);
  const [preview, setPreview] = useState<WorkItemTemplate | null>(null);
  const [reuseOpen, setReuseOpen] = useState(false);
  const setEditing=(value:WorkItemTemplate|null|undefined)=>{setEditingSnapshot(value||null);const next=new URLSearchParams(params);next.set('projectId',selectedProjectId);next.delete('templateNode');if(value)next.delete('draft');if(value===undefined)next.delete('edit');else next.set('edit',value?.id||'new');setParams(next);};
  const [archiveTarget, setArchiveTarget] = useState<WorkItemTemplate | null>(null);
  const [archiveRecheck,setArchiveRecheckState]=useState<WorkItemTemplate|null>(()=>readTemplateArchiveRecheck(recheckAccountKey,selectedProjectId));
  const [archiveRechecking,setArchiveRechecking]=useState(false),archiveNeedsReopen=Boolean(archiveRecheck);
  const setArchiveRecheck=(value:WorkItemTemplate|null)=>{persistTemplateArchiveRecheck(recheckAccountKey,selectedProjectId,value);setArchiveRecheckState(value);};
  useEffect(()=>{setArchiveRecheckState(readTemplateArchiveRecheck(recheckAccountKey,selectedProjectId));setArchiveTarget(null);setPreview(null);setReuseOpen(false);},[recheckAccountKey,selectedProjectId]);
  const archiveSubmitting = useRef(false);
  const createButton=useRef<HTMLButtonElement>(null),archiveReturnFocus=useRef<HTMLElement|null>(null);
  const {data: loadedTemplates, error, refetch, isFetching, isLoading} = usePageResources().templates;
  const data = loadedTemplates || emptyTemplates;
  const editing=params.get('edit')==='new'?null:params.get('edit')?(data.find(t=>t.id===params.get('edit'))||editingSnapshot||undefined):undefined;
  usePageScrollPosition(Boolean(loadedTemplates));
  const listUnavailable = Boolean(error && !loadedTemplates);
  const canManage = canManageProject(session, selectedProjectId);
  const project = projects.find((item) => item.id === selectedProjectId);
  const previewTemplate = preview && (data.find(item => item.id === preview.id) || preview);
  const archive = useMutation({
    mutationFn: (template: WorkItemTemplate) =>
      templatesApi.templatesById(template.id, { method: "DELETE", body: jsonBody({ expectedUpdatedAt: template.updatedAt }) }),
    onMutate:template=>setArchiveRecheck(template),
    onSuccess: () => {
      archiveReturnFocus.current=createButton.current;
      setArchiveTarget(null);
      setArchiveRecheck(null);
      invalidateTemplateViews(client, true);
    },
    onError: async (caught, template) => {
      if (isWriteOutcomeUnknown(caught)) {
        try {
          const [latestTemplates, latestArchives] = await Promise.all([
            templatesApi.templatesQuery<WorkItemTemplate[]>(encodeURIComponent(selectedProjectId), { readOnly: true }),
            archivesApi.archivesQuery<Archives>(encodeURIComponent(selectedProjectId), { readOnly: true }),
          ]);
          client.setQueryData([...keys.templates, selectedProjectId], latestTemplates);
          client.setQueryData([...keys.projectArchives, selectedProjectId], latestArchives);
          if (!latestTemplates.some((entry) => entry.id === template.id)
            && latestArchives.templates.some((entry) => entry.id === template.id)) {
            archiveReturnFocus.current=createButton.current;
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
  const recheckTemplateArchive=async()=>{if(!archiveRecheck||archiveRechecking)return;setArchiveRechecking(true);try{const [latestTemplates,latestArchives]=await Promise.all([templatesApi.templatesQuery<WorkItemTemplate[]>(encodeURIComponent(selectedProjectId), {readOnly:true}),archivesApi.archivesQuery<Archives>(encodeURIComponent(selectedProjectId), {readOnly:true})]);client.setQueryData([...keys.templates,selectedProjectId],latestTemplates);client.setQueryData([...keys.projectArchives,selectedProjectId],latestArchives);const active=latestTemplates.some(item=>item.id===archiveRecheck.id),archived=latestArchives.templates.some(item=>item.id===archiveRecheck.id);if(active!==archived){setArchiveRecheck(null);setArchiveTarget(null);invalidateTemplateViews(client,true);}}catch{/* 两份权威列表必须同时读取成功。 */}finally{setArchiveRechecking(false);}};
  if (editing !== undefined && canManage) return <><TemplateForm key={selectedProjectId+':'+(editing?.id||'new')}
    template={editing ? data.find(t=>t.id===editing.id)||editing : undefined} templateUnavailable={Boolean(editing&&loadedTemplates&&!data.some(t=>t.id===editing.id))}
    projectId={selectedProjectId} onClose={()=>setEditing(undefined)} onSaved={(value,node)=>{setEditingSnapshot(value);const p=new URLSearchParams(params);p.set('edit',value.id);p.delete('draft');if(node)p.set('templateNode',node);setParams(p,{replace:true});}}/></>;
  return (
    <>
      <PageHeader
        title="流程设计"
        actions={canManage ? (
          <><Button variant="secondary" onClick={() => setReuseOpen(true)}><Copy size={16} />复用已有流程</Button>
          <Button ref={createButton} variant="primary" className="primary-button" onClick={() => setEditing(null)}>
            <Plus size={16} />
            新建流程
          </Button></>
        ) : null}
      />
      <div className="page-content">
        {reuseOpen && canManage && <TemplateReuseDialog onClose={() => setReuseOpen(false)} onSelect={async template => {
          const draftId = await createTemplateCopyDraft(session.accountId || 'guest', selectedProjectId, template);
          setEditingSnapshot(null); setReuseOpen(false);
          const next = new URLSearchParams(params);
          next.set('projectId', selectedProjectId); next.set('edit', 'new'); next.set('draft', draftId); next.delete('templateNode');
          setParams(next);
        }} />}
        {archiveRecheck&&<div role="alert" className="warning-banner">“{archiveRecheck.name}”的流程归档结果待核对，其他归档操作暂不可用。<Button busy={(archiveRechecking)} aria-label={archiveRechecking?'读取中…':'重新读取流程与归档'} variant="secondary" type="button" className="ghost-button" disabled={archiveRechecking} onClick={()=>void recheckTemplateArchive()}>{'重新读取流程与归档'}</Button></div>}
        {error && loadedTemplates && <div className="warning-banner">流程列表刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button></div>}
        {listUnavailable ? <EmptyState title="流程列表加载失败" detail={error?.message || "暂时无法读取流程设计。"} action={<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button>} /> : <>
        <section className="template-catalog" aria-label="流程列表">
        {data.map(template => <TemplateCard key={template.id} template={template} isDefault={project?.defaultTemplateId === template.id} canManage={canManage} archiveDisabled={Boolean(archiveRecheck)} onPreview={() => setPreview(template)} onEdit={() => setEditing(template)} onArchive={() => { if (!archiveRecheck) { archiveReturnFocus.current=null; archive.reset(); setArchiveTarget(template); } }} />)}
        </section>
        {previewTemplate && <Modal title="流程预览" width={1200} onClose={() => setPreview(null)}><TemplatePreview template={previewTemplate} onEdit={canManage && data.some(item => item.id === previewTemplate.id) ? () => { setPreview(null); setEditing(previewTemplate); } : undefined} /></Modal>}
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
          return <ConfirmDialog returnFocus={()=>archiveReturnFocus.current} title="归档流程" description={<>流程“<strong>{archiveTarget.name}</strong>”归档后不再用于新需求，已有需求和历史数据不会改变。</>} confirmLabel={disabledReason ? "无法归档" : "确认归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(disabledReason)} error={disabledReason || archive.error?.message} onClose={() => setArchiveTarget(null)} onConfirm={() => submitArchive(archiveTarget)} />;
        })()}
        </>}
      </div>
    </>
  );
}
