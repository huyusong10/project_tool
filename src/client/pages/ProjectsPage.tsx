import { readRecheck, persistRecheck } from '../core/write-recheck';
import * as projectsApi from '../features/projects/api';
import * as archivesApi from '../features/archives/api';
import { Button } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { usePageScrollPosition } from '../use-page-view';
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus } from "lucide-react";
import { ApiError, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateProjectViews, keys } from "../query-keys";
import { ConfirmDialog } from "../components/Modal";
import { EmptyState, LoadingState } from "../components/Feedback";
import { StartupError } from '../features/accounts/AccessLanding';
import { usePageResources } from '../page-context';
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/Badge";
import { ProjectForm, persistProjectCreateRecheck, readProjectCreateRecheck, type ProjectCreateRecheck } from "../components/ManagementForms";
import { isAdmin } from "../permissions";
import type { Archives } from "../types";

type ProjectArchiveInput = {
  id: string;
  name: string;
  expectedUpdatedAt: string;
  force?: boolean;
  expectedRequirements?: number;
  expectedIssues?: number;
};
function projectArchiveRecheckKey(accountKey:string){return `project-manage:project-archive-command-recheck:${accountKey}`;}
function readProjectArchiveRecheck(accountKey:string):ProjectArchiveInput|null{
  return readRecheck(projectArchiveRecheckKey(accountKey), stored => {const value=stored as Partial<ProjectArchiveInput>;return typeof value.id==='string'&&typeof value.name==='string'&&typeof value.expectedUpdatedAt==='string'&&(!value.force||typeof value.expectedRequirements==='number'&&typeof value.expectedIssues==='number')?value as ProjectArchiveInput:null;
  });
}
function persistProjectArchiveRecheck(accountKey:string,value:ProjectArchiveInput|null){
  persistRecheck(projectArchiveRecheckKey(accountKey), value);
}

export function ProjectsPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const { projects: projectsQuery } = usePageResources();
  const client = useQueryClient();
  const createRecheckAccountKey=session.accountId||session.username||'guest';
  const [creating, setCreating] = useState(false);
  const [createRecheck,setCreateRecheckState]=useState<ProjectCreateRecheck|null>(()=>readProjectCreateRecheck(createRecheckAccountKey));
  const setCreateRecheck=(value:ProjectCreateRecheck|null)=>{persistProjectCreateRecheck(createRecheckAccountKey,value);setCreateRecheckState(value);};
  useEffect(()=>{setCreateRecheckState(readProjectCreateRecheck(createRecheckAccountKey));setArchiveRecheckState(readProjectArchiveRecheck(createRecheckAccountKey));setCreating(false);setArchiveTarget(null);setArchiveConflict(null);},[createRecheckAccountKey]);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string; expectedUpdatedAt: string } | null>(null);
  const [archiveConflict, setArchiveConflict] = useState<{ id: string; name: string; expectedUpdatedAt: string; requirements: number; issues: number } | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [archiveRecheck,setArchiveRecheckState]=useState<ProjectArchiveInput|null>(()=>readProjectArchiveRecheck(createRecheckAccountKey));
  const [archiveRechecking,setArchiveRechecking]=useState(false),archiveNeedsReopen=Boolean(archiveRecheck);
  const setArchiveRecheck=(value:ProjectArchiveInput|null)=>{persistProjectArchiveRecheck(createRecheckAccountKey,value);setArchiveRecheckState(value);};
  const archiveSubmitting = useRef(false);
  const admin = isAdmin(session);
  const readArchiveLists = async () => {
    const { data: projects } = await projectsQuery.refetch({ throwOnError: true });
    if (!projects) throw new Error('项目列表加载失败');
    // 项目读取可能更新访问状态；归档读取须使用更新后的状态。
    const archives = await archivesApi.archives<Archives>({ readOnly: true });
    return { projects, archives };
  };
  const archive = useMutation({
    mutationFn: ({ id, expectedUpdatedAt, force = false, expectedRequirements, expectedIssues }: ProjectArchiveInput) => projectsApi.projectsById(id, {
      method: "DELETE",
      body: jsonBody({ expectedUpdatedAt, ...(force ? { force: true, expectedRequirements, expectedIssues } : {}) }),
    }),
    onMutate:input=>setArchiveRecheck(input),
    onSuccess: () => {
      setArchiveTarget(null);
      setArchiveConflict(null);
      setArchiveError("");
      setArchiveRecheck(null);
      invalidateProjectViews(client);
    },
    onError: async (error, input) => {
      if (!input.force && error instanceof ApiError && error.code === "DEPENDENCY_CONFLICT") {
        const details = error.details as { requirements?: number; issues?: number } | undefined;
        setArchiveConflict({ id: input.id, name: input.name, expectedUpdatedAt: input.expectedUpdatedAt, requirements: Number(details?.requirements || 0), issues: Number(details?.issues || 0) });
        setArchiveTarget(null);
        setArchiveError("");
        setArchiveRecheck(null);
        return;
      }
      if (input.force && error instanceof ApiError && error.code === "DEPENDENCY_CONFLICT") {
        const details = error.details as { requirements?: number; issues?: number } | undefined;
        setArchiveConflict({
          id: input.id,
          name: input.name,
          expectedUpdatedAt: input.expectedUpdatedAt,
          requirements: Number(details?.requirements || 0),
          issues: Number(details?.issues || 0),
        });
        setArchiveError("活跃内容数量已变化，请核对更新后的影响范围并再次确认。");
        setArchiveRecheck(null);
        return;
      }
      if (isWriteOutcomeUnknown(error)) {
        try {
          const { projects: latestProjects, archives: latestArchives } = await readArchiveLists();
          client.setQueryData(keys.archives, latestArchives);
          if (!latestProjects.some((project) => project.id === input.id)
            && latestArchives.projects.some((project) => project.id === input.id)) {
            setArchiveTarget(null);
            setArchiveConflict(null);
            setArchiveError("");
            setArchiveRecheck(null);
            invalidateProjectViews(client);
            return;
          }
        } catch {
          // 保留原始写入异常；活动列表与归档列表必须同时读回才能确认归档成功。
        }
      }
      if (requiresWriteRecheck(error)) {
        setArchiveRecheck(input);
        invalidateProjectViews(client);
      }else setArchiveRecheck(null);
      setArchiveError(error instanceof Error ? error.message : "项目归档失败");
    },
    onSettled: () => { archiveSubmitting.current = false; },
  });
  const submitArchive = (input: ProjectArchiveInput) => {
    if (archiveSubmitting.current||archiveRecheck) return;
    archiveSubmitting.current = true;
    archive.mutate(input);
  };
  const recheckProjectArchive=async()=>{if(!archiveRecheck||archiveRechecking)return;setArchiveRechecking(true);try{const {projects:latestProjects,archives:latestArchives}=await readArchiveLists();client.setQueryData(keys.archives,latestArchives);const active=latestProjects.some(item=>item.id===archiveRecheck.id),archived=latestArchives.projects.some(item=>item.id===archiveRecheck.id);if(active!==archived){setArchiveRecheck(null);setArchiveTarget(null);setArchiveConflict(null);setArchiveError('');invalidateProjectViews(client);}}catch{/* 两份权威列表必须同时读取成功。 */}finally{setArchiveRechecking(false);}};
  const pagination = useListPagination({ items: projects, personal: true });
  usePageScrollPosition(true, true);
  return (
    <>
      <PageHeader
        title="项目管理"
        actions={admin ? (
          <Button variant="primary" className="primary-button" disabled={projectsQuery.unavailable || Boolean(createRecheck)} onClick={() => {if(!projectsQuery.unavailable && !createRecheck)setCreating(true);}}>
            <Plus size={16} />
            新建项目
          </Button>
        ) : null}
      />
      <div className="page-content">
        {createRecheck&&<div role="alert" className="warning-banner">项目创建结果待核对，新建入口暂不可用。<Button variant="secondary" type="button" className="ghost-button" onClick={()=>setCreating(true)}>核对项目创建</Button></div>}
        {archiveRecheck&&<div role="alert" className="warning-banner">“{archiveRecheck.name}”的项目归档结果待核对，其他归档操作暂不可用。<Button busy={(archiveRechecking)} aria-label={archiveRechecking?'读取中…':'重新读取项目与归档'} variant="secondary" type="button" className="ghost-button" disabled={archiveRechecking} onClick={()=>void recheckProjectArchive()}>{'重新读取项目与归档'}</Button></div>}
        {projectsQuery.unavailable ? projectsQuery.error || projectsQuery.data === null
          ? <StartupError title="项目列表加载失败" error={projectsQuery.error || new Error('资源不存在或当前账号无权访问。')} pending={projectsQuery.isFetching} onRetry={() => void projectsQuery.refetch()} />
          : <LoadingState label="正在加载项目列表…" className="tall" />
          : <div className="table-panel project-table paged-panel"><div className="paged-body" ref={pagination.scrollRef}>
          <table>
            <thead><tr><th>项目</th><th>计划周期</th><th>状态</th>{session.authenticated && <th>操作</th>}</tr></thead>
            <tbody>
              {pagination.items.map((project) => {
                return (
                <tr key={project.id} className={project.id === selectedProjectId ? "is-current" : ""}>
                  <td><span className="project-name-line"><strong>{project.name}</strong>{project.isSample && <span className="sample-project-badge">样板</span>}</span>{project.id === selectedProjectId && <small>当前项目</small>}</td>
                  <td><div className="inline-date-range">
                    <span>{project.plannedStart || "未设置"}</span>
                    <span>→</span>
                    <span>{project.plannedEnd || "未设置"}</span>
                  </div></td>
                  <td><StatusBadge kind="project" value={project.status} /></td>
                  {session.authenticated && (
                    <td>
                      <div className="project-row-actions">
                        {admin && <Button variant="secondary" tone="danger" size="small" className="inline-action-button danger" disabled={archive.isPending||Boolean(archiveRecheck)} onClick={() => {
                          if(archiveRecheck)return;
                          archive.reset();
                          setArchiveError("");
                          setArchiveTarget({ id: project.id, name: project.name, expectedUpdatedAt: project.updatedAt });
                        }}><Archive size={14} />归档</Button>}
                      </div>
                    </td>
                  )}
                </tr>
              );})}
            </tbody>
          </table></div>
          <Pagination {...pagination.props} label="项目列表分页" />
          {!projects.length && <EmptyState title="还没有项目" detail="创建第一个项目后即可维护需求和排期。" />}
        </div>}
        {creating && (
          <ProjectForm createRecheck={createRecheck} onCreateRecheckChange={setCreateRecheck} onClose={() => setCreating(false)} />
        )}
        {archiveTarget && (() => {
          const current = projects.find((project) => project.id === archiveTarget.id);
          const changed = Boolean(current && current.updatedAt !== archiveTarget.expectedUpdatedAt);
          const invalidReason = !current
            ? "项目已不在当前列表，请关闭窗口后刷新确认。"
            : changed || archiveNeedsReopen
              ? "项目已更新，请关闭窗口后重新选择归档。"
              : "";
          return <ConfirmDialog title="归档项目" description={<>项目“<strong>{archiveTarget.name}</strong>”将从日常页面隐藏，之后可以在归档中心恢复。</>} confirmLabel={invalidReason ? "无法归档" : "确认归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(invalidReason)} error={invalidReason || archiveError} onClose={() => { setArchiveTarget(null); setArchiveError(""); }} onConfirm={() => submitArchive({ ...archiveTarget })} />;
        })()}
        {archiveConflict && (() => {
          const current = projects.find((project) => project.id === archiveConflict.id);
          const changed = Boolean(current && current.updatedAt !== archiveConflict.expectedUpdatedAt);
          const invalidReason = !current
            ? "项目已不在当前列表，请关闭窗口后刷新确认。"
            : changed || archiveNeedsReopen
              ? "项目已更新，请关闭窗口后重新选择归档。"
              : "";
          return <ConfirmDialog title="确认强制归档" description={<div className="archive-project-confirmation"><p>项目“{archiveConflict.name}”仍有活跃内容：</p><div><strong>{archiveConflict.requirements}</strong><span>条活跃需求</span><strong>{archiveConflict.issues}</strong><span>条未解决问题</span></div><p>继续归档后，这些内容将随项目隐藏，恢复项目后仍可继续处理。</p></div>} confirmLabel={invalidReason ? "无法归档" : "仍然归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(invalidReason)} error={invalidReason || archiveError} onClose={() => { setArchiveConflict(null); setArchiveError(""); }} onConfirm={() => submitArchive({ id: archiveConflict.id, name: archiveConflict.name, expectedUpdatedAt: archiveConflict.expectedUpdatedAt, force: true, expectedRequirements: archiveConflict.requirements, expectedIssues: archiveConflict.issues })} />;
        })()}
      </div>
    </>
  );
}
