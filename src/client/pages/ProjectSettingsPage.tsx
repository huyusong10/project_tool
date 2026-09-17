import { readRecheckFlag, persistRecheckFlag } from '../core/write-recheck';
import * as projectsApi from '../features/projects/api';
import * as archivesApi from '../features/archives/api';
import * as peopleApi from '../features/people/api';
import { Button } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { usePageScrollPosition } from '../use-page-view';
import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { Archive, Edit3, RotateCcw, UserMinus, UserPlus } from "lucide-react";
import { jsonBody, requiresWriteRecheck } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateArchiveViews, invalidateProjectAccessViews, invalidateProjectMemberViews, keys } from "../query-keys";
import type { Archives, Person } from "../types";
import { ConfirmDialog, Modal } from "../components/Modal";
import { EmptyState, LoadingState } from "../components/Feedback";
import { Avatar } from "../components/Avatar";
import { StatusBadge } from "../components/Badge";
import { PageHeader } from "../components/PageHeader";
import { ProjectForm } from "../components/ManagementForms";
import { canManageProject } from "../permissions";
import { SearchInput } from "../components/SearchInput";
import { useToast } from "../components/Toast";

type ProjectMemberRole = "manager" | "member" | "viewer";

function readProjectArchiveRecheck(accountKey: string, projectId: string) { return !!projectId && readRecheckFlag(`project-manage:project-archive-recheck:${accountKey}:${projectId}`); }

function persistProjectArchiveRecheck(accountKey: string, projectId: string, required: boolean) { if(projectId) persistRecheckFlag(`project-manage:project-archive-recheck:${accountKey}:${projectId}`, required); }

function readProjectMembersRecheck(accountKey: string, projectId: string) { return !!projectId && readRecheckFlag(`project-manage:project-members-recheck:${accountKey}:${projectId}`); }

function persistProjectMembersRecheck(accountKey: string, projectId: string, required: boolean) { if(projectId) persistRecheckFlag(`project-manage:project-members-recheck:${accountKey}:${projectId}`, required); }

export function ProjectSettingsPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const recheckAccountKey = session.accountId || session.username || "guest";
  const client = useQueryClient();
  const toast = useToast();
  const project = projects.find((item) => item.id === selectedProjectId);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [projectArchiveNeedsRecheck, setProjectArchiveNeedsRecheckState] = useState(() => readProjectArchiveRecheck(recheckAccountKey, selectedProjectId));
  const [membersNeedRecheck, setMembersNeedRecheckState] = useState(() => readProjectMembersRecheck(recheckAccountKey, selectedProjectId));
  const setProjectArchiveNeedsRecheck = (value: boolean, projectId = selectedProjectId) => {
    persistProjectArchiveRecheck(recheckAccountKey, projectId, value);
    if (projectId === selectedProjectId) setProjectArchiveNeedsRecheckState(value);
  };
  const setMembersNeedRecheck = (value: boolean, projectId = selectedProjectId) => {
    persistProjectMembersRecheck(recheckAccountKey, projectId, value);
    if (projectId === selectedProjectId) setMembersNeedRecheckState(value);
  };
  useEffect(() => {
    setProjectArchiveNeedsRecheckState(readProjectArchiveRecheck(recheckAccountKey, selectedProjectId));
    setMembersNeedRecheckState(readProjectMembersRecheck(recheckAccountKey, selectedProjectId));
  }, [recheckAccountKey, selectedProjectId]);
  const [pendingRole, setPendingRole] = useState<{ projectId: string; personId: string; role: ProjectMemberRole; expectedMembershipUpdatedAt: string | null } | null>(null);
  const restoreSubmitting = useRef(false);
  const roleSubmitting = useRef(false);
  const canManage = canManageProject(session, selectedProjectId);
  const membersQuery = useQuery({
    queryKey: [...keys.projectMembers, selectedProjectId],
    queryFn: ({ signal }) => projectsApi.projectsMembers<Person[]>(selectedProjectId, { signal }),
    enabled: Boolean(selectedProjectId),
  });
  const members = membersQuery.data || [];
  const setRole = useMutation({
    mutationFn: ({ projectId, personId, role, expectedMembershipUpdatedAt }: { projectId: string; personId: string; role: ProjectMemberRole; expectedMembershipUpdatedAt: string | null }) =>
      projectsApi.projectsMembersById<Person>(projectId, personId, { method: "PUT", body: jsonBody({ role, expectedMembershipUpdatedAt }) }),
    onMutate: async (input) => {
      const queryKey = [...keys.projectMembers, input.projectId];
      await client.cancelQueries({ queryKey, exact: true });
      const query = client.getQueryCache().find({ queryKey, exact: true });
      return { query, data: query?.state.data } as { query: Query | undefined; data: unknown };
    },
    onSuccess: (saved, input, snapshot) => {
      setMembersNeedRecheck(false, input.projectId);
      const queryKey = [...keys.projectMembers, input.projectId];
      const currentQuery = client.getQueryCache().find({ queryKey, exact: true });
      if (snapshot?.query && currentQuery === snapshot.query && currentQuery.state.data === snapshot.data) {
        client.setQueryData<Person[]>(queryKey, (current = []) => current.map((person) => person.id === saved.id ? saved : person));
      }
      invalidateProjectAccessViews(client);
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await projectsApi.projectsMembers<Person[]>(input.projectId, { readOnly: true });
        client.setQueryData([...keys.projectMembers, input.projectId], latest);
        setMembersNeedRecheck(false, input.projectId);
        if (latest.find((person) => person.id === input.personId)?.projectRole === input.role) {
          setRole.reset();
          invalidateProjectAccessViews(client);
          toast.success("已核对最新状态：项目角色已更新");
        }
      } catch {
        setMembersNeedRecheck(true, input.projectId);
      }
    },
    onSettled: () => {
      roleSubmitting.current = false;
      setPendingRole(null);
    },
  });
  const remove = useMutation({
    mutationFn: ({ projectId, person }: { projectId: string; person: Person }) => projectsApi.projectsMembersById(projectId, person.id, {
      method: "DELETE", body: jsonBody({ expectedMembershipUpdatedAt: person.membershipUpdatedAt || null }),
    }),
    onSuccess: (_saved, input) => {
      setMembersNeedRecheck(false, input.projectId);
      setRemoveTarget(null);
      invalidateProjectAccessViews(client);
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await projectsApi.projectsMembers<Person[]>(input.projectId, { readOnly: true });
        client.setQueryData([...keys.projectMembers, input.projectId], latest);
        setMembersNeedRecheck(false, input.projectId);
        const current = latest.find((person) => person.id === input.person.id);
        if (!current) {
          setRemoveTarget(null);
          invalidateProjectAccessViews(client);
          toast.success("已核对最新状态：项目成员已移除");
        } else {
          setRemoveTarget(current);
        }
      } catch {
        setMembersNeedRecheck(true, input.projectId);
      }
    },
  });
  const reloadMembers = async () => {
    const result = await membersQuery.refetch();
    if (result.error || !result.data) return;
    setMembersNeedRecheck(false);
    setRole.reset();
    remove.reset();
    if (removeTarget) {
      setRemoveTarget(result.data.find((person) => person.id === removeTarget.id) || null);
    }
  };
  const memberMutationBusy = Boolean(pendingRole) || setRole.isPending || remove.isPending || membersNeedRecheck;
  const changeRole = (person: Person, role: ProjectMemberRole) => {
    if (roleSubmitting.current || remove.isPending || membersNeedRecheck) return;
    roleSubmitting.current = true;
    remove.reset();
    setRole.reset();
    const input = { projectId: selectedProjectId, personId: person.id, role, expectedMembershipUpdatedAt: person.membershipUpdatedAt || null };
    setPendingRole(input);
    setRole.mutate(input);
  };
  const projectArchivesQuery = useQuery({
    queryKey: [...keys.projectArchives, selectedProjectId],
    queryFn: ({ signal }) => archivesApi.archivesQuery<Archives>(encodeURIComponent(selectedProjectId), { signal }),
    enabled: canManage && Boolean(selectedProjectId),
  });
  const projectArchives = projectArchivesQuery.data;
  const membersPagination = useListPagination({ items: members, id: 'members', ready: Boolean(membersQuery.data), loading: membersQuery.isFetching, disabled: memberMutationBusy });
  const archiveItems = [...(projectArchives?.requirements || []).map(item => ({...item, entity: 'requirements' as const, type: '需求'})), ...(projectArchives?.templates || []).map(item => ({...item, entity: 'templates' as const, type: '流程'}))].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));
  const archivesPagination = useListPagination({ items: archiveItems, id: 'archives', ready: Boolean(projectArchives), loading: projectArchivesQuery.isFetching });
  usePageScrollPosition(Boolean(membersQuery.data) && (!canManage || Boolean(projectArchives)));
  const restore = useMutation({
    mutationFn: ({ entity, id, expectedDeletedAt }: { projectId: string; entity: "requirements" | "templates"; id: string; expectedDeletedAt: string }) => archivesApi.ResourceRestore(entity, id, { method: "POST", body: jsonBody({ expectedDeletedAt }) }),
    onSuccess: (_saved, input) => {
      setProjectArchiveNeedsRecheck(false, input.projectId);
      invalidateArchiveViews(client);
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await archivesApi.archivesQuery<Archives>(encodeURIComponent(input.projectId), { readOnly: true });
        client.setQueryData([...keys.projectArchives, input.projectId], latest);
        setProjectArchiveNeedsRecheck(false, input.projectId);
        if (!latest[input.entity].some((item) => item.id === input.id)) {
          restore.reset();
          invalidateArchiveViews(client);
          toast.success("已核对最新状态：内容已移出项目归档");
        } else {
          restore.reset();
          toast.info("已核对最新状态：内容仍在项目归档中，可以重新操作");
        }
      } catch {
        setProjectArchiveNeedsRecheck(true, input.projectId);
      }
    },
    onSettled: () => {
      restoreSubmitting.current = false;
      setRestoringKey(null);
    },
  });
  const reloadProjectArchives = async () => {
    const result = await projectArchivesQuery.refetch();
    if (result.error || !result.data) return;
    setProjectArchiveNeedsRecheck(false);
    restore.reset();
  };
  const restoreArchive = (entity: "requirements" | "templates", id: string, expectedDeletedAt: string) => {
    if (restoreSubmitting.current || projectArchiveNeedsRecheck) return;
    restoreSubmitting.current = true;
    restore.reset();
    setRestoringKey(`${entity}:${id}`);
    restore.mutate({ projectId: selectedProjectId, entity, id, expectedDeletedAt });
  };
  return <>
    <PageHeader title="项目设置" secondaryActions={project&&canManage?<Button variant="secondary" className="ghost-button" disabled={!membersQuery.data || memberMutationBusy} onClick={() => setAdding(true)}><UserPlus size={15} />添加成员</Button>:null} actions={project&&canManage?<Button variant="primary" className="primary-button" onClick={() => setEditing(true)}><Edit3 size={15} />编辑项目</Button>:null} />
    <div className="page-content">
      {!project ? <EmptyState title="暂无可访问项目" detail="请联系管理员分配项目权限。" /> : <>
        <section className="panel project-settings-summary">
          <header><div><h2>{project.name}</h2><p>{project.plannedStart || "未设置开始"} — {project.plannedEnd || "未设置完成"}</p></div><StatusBadge kind="project" value={project.status} /></header>
        </section>
        <section className="panel project-members-panel paged-panel">
          <header>
            <div><h2>项目成员</h2><p>在当前项目内配置项目经理、项目成员和观察者</p></div>
            <div className="project-member-header-actions">
              <span className="project-member-count">{membersQuery.data ? `${members.length} 人` : "—"}</span>
            </div>
          </header>
          {membersNeedRecheck && <div role="alert" className="warning-banner">成员操作结果待核对，当前权限可能已变化，本窗口不会重复提交。<Button busy={(membersQuery.isFetching)} aria-label={membersQuery.isFetching ? "读取中…" : "重新读取成员"} variant="secondary" className="ghost-button" disabled={membersQuery.isFetching} onClick={() => void reloadMembers()}>{"重新读取成员"}</Button></div>}
          {membersQuery.error && membersQuery.data && <div className="warning-banner">成员列表刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={membersQuery.isFetching} onClick={() => void membersQuery.refetch()}>重新加载</Button></div>}
          <div className="project-member-list paged-body" ref={membersPagination.scrollRef}>
            {membersQuery.isLoading && !membersQuery.data && <LoadingState label="正在加载项目成员…" className="stable-panel-state" />}
            {membersQuery.error && !membersQuery.data && <EmptyState title="项目成员加载失败" detail={membersQuery.error.message || "暂时无法读取项目成员，请稍后重试。"} action={<Button variant="secondary" className="ghost-button" disabled={membersQuery.isFetching} onClick={() => void membersQuery.refetch()}>重新加载</Button>} />}
            {membersQuery.data && membersPagination.items.map((person) => {
              const roleLabel = person.projectRole === "manager" ? "项目经理" : person.projectRole === "viewer" ? "观察者" : "项目成员";
              const editable = canManage;
              return <article className={`project-member-row${canManage ? " can-manage" : ""}`} key={person.id}>
                <div className="project-member-identity">
                  <Avatar name={person.name} className="project-member-avatar" />
                  <div><strong>{person.name}</strong><small>{person.username ? `账号 ${person.username}` : "未关联账号"}</small></div>
                </div>
                <div className="project-member-meta"><small>岗位</small><strong>{person.jobTitle || "岗位未设置"}</strong></div>
                <div className="project-member-role">
                  <small>项目角色</small>
                  {editable ? <select aria-label={`${person.name}的项目角色`} value={pendingRole?.projectId === selectedProjectId && pendingRole.personId === person.id ? pendingRole.role : person.projectRole || "member"} disabled={memberMutationBusy} onChange={(event) => changeRole(person, event.target.value as ProjectMemberRole)}>
                    <option value="manager">项目经理</option><option value="member">项目成员</option><option value="viewer">观察者</option>
                  </select> : <span className={`project-role-badge role-${person.projectRole || "member"}`}>{roleLabel}</span>}
                </div>
                {canManage && <div className="project-member-action"><Button variant="secondary" tone="danger" size="small" className="inline-action-button danger" disabled={memberMutationBusy} onClick={() => { setRole.reset(); remove.reset(); setRemoveTarget(person); }}><UserMinus size={14} />移除</Button></div>}
              </article>;
            })}
            {membersQuery.data && !members.length && <EmptyState title="暂无项目成员" detail="点击“添加成员”，从平台人员中选择成员加入项目。" />}
          </div>
          <Pagination {...membersPagination.props} label="项目成员分页" />
          {(setRole.error || remove.error) && <p className="form-error">{(setRole.error || remove.error)?.message}</p>}
        </section>
        {canManage && <section className="panel project-members-panel paged-panel">
          <header><div><h2>项目归档</h2><p>恢复当前项目已归档的需求或流程</p></div></header>
          {projectArchiveNeedsRecheck && <div role="alert" className="warning-banner">项目归档恢复结果待核对，当前归档事实可能已变化，本页面不会重复提交。<Button busy={(projectArchivesQuery.isFetching)} aria-label={projectArchivesQuery.isFetching ? "读取中…" : "重新读取项目归档"} variant="secondary" className="ghost-button" disabled={projectArchivesQuery.isFetching} onClick={() => void reloadProjectArchives()}>{"重新读取项目归档"}</Button></div>}
          {projectArchivesQuery.error && projectArchives && <div className="warning-banner">项目归档刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={projectArchivesQuery.isFetching} onClick={() => void projectArchivesQuery.refetch()}>重新加载</Button></div>}
          <div className="compact-list paged-body" ref={archivesPagination.scrollRef}>
            {projectArchivesQuery.isLoading && !projectArchives && <LoadingState label="正在加载项目归档…" className="stable-panel-state" />}
            {projectArchivesQuery.error && !projectArchives && <EmptyState title="项目归档加载失败" detail={projectArchivesQuery.error.message || "暂时无法读取项目归档，请稍后重试。"} action={<Button variant="secondary" className="ghost-button" disabled={projectArchivesQuery.isFetching} onClick={() => void projectArchivesQuery.refetch()}>重新加载</Button>} />}
            {projectArchives && archivesPagination.items.map((item) => <div key={item.entity + item.id}><Archive size={15} /><div><strong>{item.title}</strong><span>{item.type} · {new Date(item.deletedAt).toLocaleString()}</span></div><Button busy={(restoringKey === `${item.entity}:${item.id}`)} aria-label={restoringKey === `${item.entity}:${item.id}` ? "恢复中…" : "恢复"} variant="link" size="small" className="compact-text-button" disabled={Boolean(restoringKey) || projectArchiveNeedsRecheck} onClick={() => restoreArchive(item.entity, item.id, item.deletedAt)}><RotateCcw size={14} />{"恢复"}</Button></div>)}
            {projectArchives && !projectArchives.requirements.length && !projectArchives.templates.length && <EmptyState title="暂无项目归档" detail="归档需求或流程后会显示在这里。" />}
          </div>
          <Pagination {...archivesPagination.props} label="项目归档分页" />
          {restore.error && <p className="form-error">{restore.error.message}</p>}
        </section>}
      </>}
      {editing && project && <ProjectForm project={project} onClose={() => setEditing(false)} />}
      {adding && <AddProjectPersonForm projectId={selectedProjectId} onNeedsRecheck={() => setMembersNeedRecheck(true)} onClose={() => setAdding(false)} />}
      {removeTarget && <ConfirmDialog title="移出项目成员" description={<>将“<strong>{removeTarget.name}</strong>”移出当前项目？人员资料和其他项目权限不会受到影响。</>} confirmLabel="确认移出" pendingLabel="移除中…" danger pending={remove.isPending} disabled={membersNeedRecheck} error={remove.error?.message} onClose={() => { remove.reset(); setRemoveTarget(null); }} onConfirm={() => remove.mutate({ projectId: selectedProjectId, person: removeTarget })} />}
    </div>
  </>;
}
type ProjectPersonCandidate = Person & {
  canAdd: boolean;
  unavailableReason: "already_member" | "inactive" | "archived" | null;
  existingProjectRole: "manager" | "member" | "viewer" | null;
};

const candidateReasonLabels = {
  already_member: "已是项目成员",
  inactive: "人员已停用",
  archived: "人员已归档",
} as const;

function AddProjectPersonForm({ projectId, onNeedsRecheck, onClose }: { projectId: string; onNeedsRecheck: () => void; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [keyword, setKeyword] = useState("");
  const [selectedPeople, setSelectedPeople] = useState<Record<string, string>>({});
  const [role, setRole] = useState<ProjectMemberRole>("member");
  const [batchError, setBatchError] = useState("");
  const [batchNeedsRecheck, setBatchNeedsRecheck] = useState(false);
  const submitting = useRef(false);
  const deferredKeyword = useDeferredValue(keyword.trim());
  const candidatesQuery = useQuery({
    queryKey: [...keys.peopleCandidates, projectId, deferredKeyword],
    queryFn: ({ signal }) => peopleApi.peopleCandidatesQuery<ProjectPersonCandidate[]>(encodeURIComponent(projectId), deferredKeyword ? `&q=${encodeURIComponent(deferredKeyword)}` : "", { signal }),
    enabled: Boolean(projectId),
  });
  const people = candidatesQuery.data || [];
  const selectedIds = Object.keys(selectedPeople);
  const mutation = useMutation({
    mutationFn: async ({ personIds, role }: { personIds: string[]; role: ProjectMemberRole }) => {
      const attempts: Array<{ id: string; name: string; message: string; needsRecheck: boolean }> = [];
      for (const personId of personIds) {
        try {
          await projectsApi.projectsMembersById(projectId, personId, { method: "PUT", body: jsonBody({ role, expectedMembershipUpdatedAt: null }) });
        } catch (error) {
          attempts.push({
            id: personId,
            name: selectedPeople[personId] || personId,
            message: error instanceof Error ? error.message : "添加失败",
            needsRecheck: requiresWriteRecheck(error),
          });
        }
      }
      let confirmed = new Set<string>();
      let recheckFailed = false;
      if (attempts.some((item) => item.needsRecheck)) {
        try {
          const latest = await projectsApi.projectsMembers<Person[]>(projectId, { readOnly: true });
          confirmed = new Set(attempts.filter((item) => item.needsRecheck
            && latest.find((person) => person.id === item.id)?.projectRole === role).map((item) => item.id));
        } catch {
          recheckFailed = true;
        }
      }
      return { failed: attempts.filter((item) => !confirmed.has(item.id)), confirmed: confirmed.size, recheckFailed };
    },
    onSuccess: ({ failed, confirmed, recheckFailed }) => {
      invalidateProjectMemberViews(client);
      if (confirmed) toast.success(`已核对最新状态：${confirmed} 位成员已加入`);
      if (!failed.length) { onClose(); return; }
      setSelectedPeople(Object.fromEntries(failed.map((item) => [item.id, item.name])));
      if (recheckFailed) {
        setBatchError("");
        setBatchNeedsRecheck(true);
        onNeedsRecheck();
        return;
      }
      setBatchError(failed.map((item) => `${item.name}：${item.message}`).join("；"));
    },
    onSettled: () => { submitting.current = false; },
  });
  const batchBusy = mutation.isPending || batchNeedsRecheck;
  return <Modal title="添加项目成员" width={620} onClose={() => { if (!submitting.current) onClose(); }} closable={!mutation.isPending}><form className="member-picker-form" onSubmit={(event) => {
    event.preventDefault();
    if (submitting.current || batchNeedsRecheck || !selectedIds.length) return;
    submitting.current = true;
    setBatchError("");
    mutation.mutate({ personIds: selectedIds, role });
  }}>
    <SearchInput className="member-picker-search" value={keyword} onChange={setKeyword} disabled={batchBusy} placeholder="搜索姓名、岗位、登录名或拼音" autoFocus />
    <div className="member-picker-selection"><span>已选择 <strong>{selectedIds.length}</strong> 人</span>{selectedIds.length > 0 && <Button variant="secondary" type="button" disabled={batchBusy} onClick={() => { setSelectedPeople({}); setBatchError(""); }}>清空选择</Button>}</div>
    <div className="member-candidate-list" aria-label="可添加人员">
      {candidatesQuery.isLoading && <LoadingState label="正在加载可添加人员…" className="member-picker-state" />}
      {candidatesQuery.isError && <div className="member-picker-state is-error"><strong>候选人员加载失败</strong><span>{candidatesQuery.error.message}</span><Button variant="link" size="small" type="button" className="compact-text-button" onClick={() => void candidatesQuery.refetch()}>重试</Button></div>}
      {!candidatesQuery.isLoading && !candidatesQuery.isError && people.map((person) => <button
        type="button"
        className={`member-candidate-option${selectedPeople[person.id] ? " is-selected" : ""}`}
        aria-pressed={Boolean(selectedPeople[person.id])}
        key={person.id}
        disabled={!person.canAdd || batchBusy}
        onClick={() => {
          setBatchError("");
          setSelectedPeople((current) => {
            if (current[person.id]) { const next = { ...current }; delete next[person.id]; return next; }
            return { ...current, [person.id]: person.name };
          });
        }}
      >
        <Avatar name={person.name} className="project-member-avatar" />
        <span><strong>{person.name}</strong><small>{person.jobTitle || "岗位未设置"}{person.username ? ` · ${person.username}` : ""}</small></span>
        <span className="member-candidate-check">{person.unavailableReason ? candidateReasonLabels[person.unavailableReason] : selectedPeople[person.id] ? "✓ 已选" : "选择"}</span>
      </button>)}
      {!candidatesQuery.isLoading && !candidatesQuery.isError && !people.length && <div className="member-picker-state"><strong>{keyword ? "没有匹配的人员" : "暂无可添加人员"}</strong><span>{keyword ? "请调整搜索关键词。" : "当前启用人员均已加入项目，或请先到人员与权限新增人员。"}</span></div>}
    </div>
    <label className="field member-picker-role"><span>加入后的项目角色</span><select disabled={batchBusy} value={role} onChange={(event) => setRole(event.target.value as ProjectMemberRole)}><option value="member">项目成员</option><option value="viewer">项目观察者</option><option value="manager">项目经理</option></select></label>
    {batchNeedsRecheck && <p className="form-error" role="alert">成员添加结果待核对，当前批次不会重复提交。请关闭后在项目成员列表重新读取。</p>}
    {batchError && <p className="form-error">部分成员添加失败：{batchError}</p>}
    <div className="form-actions"><Button variant="secondary" type="button" className="ghost-button" disabled={mutation.isPending} onClick={onClose}>{batchNeedsRecheck ? "关闭并核对" : "取消"}</Button><Button variant="primary" type="submit" className="primary-button" disabled={!selectedIds.length || batchBusy}>{mutation.isPending ? `正在添加 ${selectedIds.length} 人…` : `添加 ${selectedIds.length} 人到项目`}</Button></div>
  </form></Modal>;
}
