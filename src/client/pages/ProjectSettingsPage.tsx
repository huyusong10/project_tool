import { useDeferredValue, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { Archive, Edit3, RotateCcw, UserMinus, UserPlus } from "lucide-react";
import { api, jsonBody, requiresWriteRecheck } from "../api";
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

export function ProjectSettingsPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const client = useQueryClient();
  const toast = useToast();
  const project = projects.find((item) => item.id === selectedProjectId);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Person | null>(null);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<{ projectId: string; personId: string; role: ProjectMemberRole; expectedMembershipUpdatedAt: string | null } | null>(null);
  const restoreSubmitting = useRef(false);
  const roleSubmitting = useRef(false);
  const canManage = canManageProject(session, selectedProjectId);
  const membersQuery = useQuery({
    queryKey: [...keys.projectMembers, selectedProjectId],
    queryFn: ({ signal }) => api<Person[]>("/api/projects/" + selectedProjectId + "/members", { signal }),
    enabled: Boolean(selectedProjectId),
  });
  const members = membersQuery.data || [];
  const setRole = useMutation({
    mutationFn: ({ projectId, personId, role, expectedMembershipUpdatedAt }: { projectId: string; personId: string; role: ProjectMemberRole; expectedMembershipUpdatedAt: string | null }) =>
      api<Person>("/api/projects/" + projectId + "/members/" + personId, { method: "PUT", body: jsonBody({ role, expectedMembershipUpdatedAt }) }),
    onMutate: async (input) => {
      const queryKey = [...keys.projectMembers, input.projectId];
      await client.cancelQueries({ queryKey, exact: true });
      const query = client.getQueryCache().find({ queryKey, exact: true });
      return { query, data: query?.state.data } as { query: Query | undefined; data: unknown };
    },
    onSuccess: (saved, input, snapshot) => {
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
        const latest = await api<Person[]>(`/api/projects/${input.projectId}/members`, { readOnly: true });
        if (latest.find((person) => person.id === input.personId)?.projectRole === input.role) {
          setRole.reset();
          invalidateProjectAccessViews(client);
          toast.success("已核对最新状态：项目角色已更新");
        }
      } catch {
        // 保留原写入错误，列表失效后由下一次读取恢复。
      }
    },
    onSettled: () => {
      roleSubmitting.current = false;
      setPendingRole(null);
    },
  });
  const remove = useMutation({
    mutationFn: ({ projectId, person }: { projectId: string; person: Person }) => api("/api/projects/" + projectId + "/members/" + person.id, {
      method: "DELETE", body: jsonBody({ expectedMembershipUpdatedAt: person.membershipUpdatedAt || null }),
    }),
    onSuccess: () => {
      setRemoveTarget(null);
      invalidateProjectAccessViews(client);
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await api<Person[]>(`/api/projects/${input.projectId}/members`, { readOnly: true });
        if (!latest.some((person) => person.id === input.person.id)) {
          setRemoveTarget(null);
          invalidateProjectAccessViews(client);
          toast.success("已核对最新状态：项目成员已移除");
        }
      } catch {
        // 保留原写入错误，确认框继续显示并允许重试。
      }
    },
  });
  const memberMutationBusy = Boolean(pendingRole) || setRole.isPending || remove.isPending;
  const changeRole = (person: Person, role: ProjectMemberRole) => {
    if (roleSubmitting.current || remove.isPending) return;
    roleSubmitting.current = true;
    remove.reset();
    setRole.reset();
    const input = { projectId: selectedProjectId, personId: person.id, role, expectedMembershipUpdatedAt: person.membershipUpdatedAt || null };
    setPendingRole(input);
    setRole.mutate(input);
  };
  const projectArchivesQuery = useQuery({
    queryKey: [...keys.projectArchives, selectedProjectId],
    queryFn: ({ signal }) => api<Archives>("/api/archives?projectId=" + encodeURIComponent(selectedProjectId), { signal }),
    enabled: canManage && Boolean(selectedProjectId),
  });
  const projectArchives = projectArchivesQuery.data;
  const restore = useMutation({
    mutationFn: ({ entity, id, expectedDeletedAt }: { projectId: string; entity: "requirements" | "templates"; id: string; expectedDeletedAt: string }) => api("/api/" + entity + "/" + id + "/restore", { method: "POST", body: jsonBody({ expectedDeletedAt }) }),
    onSuccess: () => {
      invalidateArchiveViews(client);
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await api<Archives>(`/api/archives?projectId=${encodeURIComponent(input.projectId)}`, { readOnly: true });
        if (!latest[input.entity].some((item) => item.id === input.id)) {
          restore.reset();
          invalidateArchiveViews(client);
          toast.success("已核对最新状态：内容已移出项目归档");
        }
      } catch {
        // 保留原写入错误，归档项继续显示并允许重试。
      }
    },
    onSettled: () => {
      restoreSubmitting.current = false;
      setRestoringKey(null);
    },
  });
  const restoreArchive = (entity: "requirements" | "templates", id: string, expectedDeletedAt: string) => {
    if (restoreSubmitting.current) return;
    restoreSubmitting.current = true;
    restore.reset();
    setRestoringKey(`${entity}:${id}`);
    restore.mutate({ projectId: selectedProjectId, entity, id, expectedDeletedAt });
  };
  return <>
    <PageHeader title="项目设置" actions={project?<><></>{canManage?<button className="primary-button" onClick={() => setEditing(true)}><Edit3 size={15} />编辑项目</button>:null}</>:null} />
    <div className="page-content">
      {!project ? <EmptyState title="暂无可访问项目" detail="请联系管理员分配项目权限。" /> : <>
        <section className="panel project-settings-summary">
          <header><div><h2>{project.name}</h2><p>{project.plannedStart || "未设置开始"} — {project.plannedEnd || "未设置完成"}</p></div><StatusBadge kind="project" value={project.status} /></header>
        </section>
        <section className="panel project-members-panel">
          <header>
            <div><h2>项目成员</h2><p>在当前项目内配置项目经理、项目成员和观察者</p></div>
            <div className="project-member-header-actions">
              <span className="project-member-count">{membersQuery.data ? `${members.length} 人` : "—"}</span>
              {canManage && <button className="ghost-button" disabled={!membersQuery.data} onClick={() => setAdding(true)}><UserPlus size={15} />添加成员</button>}
            </div>
          </header>
          {membersQuery.error && membersQuery.data && <div className="warning-banner">成员列表刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={membersQuery.isFetching} onClick={() => void membersQuery.refetch()}>重新加载</button></div>}
          <div className="project-member-list">
            {membersQuery.isLoading && !membersQuery.data && <LoadingState label="正在加载项目成员…" className="stable-panel-state" />}
            {membersQuery.error && !membersQuery.data && <EmptyState title="项目成员加载失败" detail={membersQuery.error.message || "暂时无法读取项目成员，请稍后重试。"} action={<button className="ghost-button" disabled={membersQuery.isFetching} onClick={() => void membersQuery.refetch()}>重新加载</button>} />}
            {membersQuery.data && members.map((person) => {
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
                {canManage && <div className="project-member-action"><button className="inline-action-button danger" disabled={memberMutationBusy} onClick={() => { setRole.reset(); remove.reset(); setRemoveTarget(person); }}><UserMinus size={14} />移除</button></div>}
              </article>;
            })}
            {membersQuery.data && !members.length && <EmptyState title="暂无项目成员" detail="点击“添加成员”，从平台人员中选择成员加入项目。" />}
          </div>
          {(setRole.error || remove.error) && <p className="form-error">{(setRole.error || remove.error)?.message}</p>}
        </section>
        {canManage && <section className="panel project-members-panel">
          <header><div><h2>项目归档</h2><p>恢复当前项目已归档的需求或流程</p></div></header>
          {projectArchivesQuery.error && projectArchives && <div className="warning-banner">项目归档刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={projectArchivesQuery.isFetching} onClick={() => void projectArchivesQuery.refetch()}>重新加载</button></div>}
          <div className="compact-list">
            {projectArchivesQuery.isLoading && !projectArchives && <LoadingState label="正在加载项目归档…" className="stable-panel-state" />}
            {projectArchivesQuery.error && !projectArchives && <EmptyState title="项目归档加载失败" detail={projectArchivesQuery.error.message || "暂时无法读取项目归档，请稍后重试。"} action={<button className="ghost-button" disabled={projectArchivesQuery.isFetching} onClick={() => void projectArchivesQuery.refetch()}>重新加载</button>} />}
            {projectArchives && [...projectArchives.requirements.map((item) => ({ ...item, entity: "requirements" as const, type: "需求" })), ...projectArchives.templates.map((item) => ({ ...item, entity: "templates" as const, type: "流程" }))].map((item) => <div key={item.entity + item.id}><Archive size={15} /><div><strong>{item.title}</strong><span>{item.type} · {new Date(item.deletedAt).toLocaleString()}</span></div><button className="compact-text-button" disabled={Boolean(restoringKey)} onClick={() => restoreArchive(item.entity, item.id, item.deletedAt)}><RotateCcw size={14} />{restoringKey === `${item.entity}:${item.id}` ? "恢复中…" : "恢复"}</button></div>)}
            {projectArchives && !projectArchives.requirements.length && !projectArchives.templates.length && <EmptyState title="暂无项目归档" detail="归档需求或流程后会显示在这里。" />}
          </div>
          {restore.error && <p className="form-error">{restore.error.message}</p>}
        </section>}
      </>}
      {editing && project && <ProjectForm project={project} onClose={() => setEditing(false)} />}
      {adding && <AddProjectPersonForm projectId={selectedProjectId} onClose={() => setAdding(false)} />}
      {removeTarget && <ConfirmDialog title="移出项目成员" description={<>将“<strong>{removeTarget.name}</strong>”移出当前项目？人员资料和其他项目权限不会受到影响。</>} confirmLabel="确认移出" pendingLabel="移除中…" danger pending={remove.isPending} error={remove.error?.message} onClose={() => { remove.reset(); setRemoveTarget(null); }} onConfirm={() => remove.mutate({ projectId: selectedProjectId, person: removeTarget })} />}
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

function AddProjectPersonForm({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const [keyword, setKeyword] = useState("");
  const [selectedPeople, setSelectedPeople] = useState<Record<string, string>>({});
  const [role, setRole] = useState<ProjectMemberRole>("member");
  const [batchError, setBatchError] = useState("");
  const submitting = useRef(false);
  const deferredKeyword = useDeferredValue(keyword.trim());
  const candidatesQuery = useQuery({
    queryKey: [...keys.peopleCandidates, projectId, deferredKeyword],
    queryFn: ({ signal }) => api<ProjectPersonCandidate[]>(`/api/people/candidates?projectId=${encodeURIComponent(projectId)}${deferredKeyword ? `&q=${encodeURIComponent(deferredKeyword)}` : ""}`, { signal }),
    enabled: Boolean(projectId),
  });
  const people = candidatesQuery.data || [];
  const selectedIds = Object.keys(selectedPeople);
  const mutation = useMutation({
    mutationFn: async ({ personIds, role }: { personIds: string[]; role: ProjectMemberRole }) => {
      const attempts: Array<{ id: string; name: string; message: string; needsRecheck: boolean }> = [];
      for (const personId of personIds) {
        try {
          await api(`/api/projects/${projectId}/members/${personId}`, { method: "PUT", body: jsonBody({ role, expectedMembershipUpdatedAt: null }) });
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
      if (attempts.some((item) => item.needsRecheck)) {
        try {
          const latest = await api<Person[]>(`/api/projects/${projectId}/members`, { readOnly: true });
          confirmed = new Set(attempts.filter((item) => item.needsRecheck
            && latest.find((person) => person.id === item.id)?.projectRole === role).map((item) => item.id));
        } catch {
          // 查询失败时保留原失败项，避免把未确认的成员当作已加入。
        }
      }
      return { failed: attempts.filter((item) => !confirmed.has(item.id)), confirmed: confirmed.size };
    },
    onSuccess: ({ failed, confirmed }) => {
      invalidateProjectMemberViews(client);
      if (confirmed) toast.success(`已核对最新状态：${confirmed} 位成员已加入`);
      if (!failed.length) { onClose(); return; }
      setSelectedPeople(Object.fromEntries(failed.map((item) => [item.id, item.name])));
      setBatchError(failed.map((item) => `${item.name}：${item.message}`).join("；"));
    },
    onSettled: () => { submitting.current = false; },
  });
  return <Modal title="添加项目成员" width={620} onClose={() => { if (!submitting.current) onClose(); }} closable={!mutation.isPending}><form className="member-picker-form" onSubmit={(event) => {
    event.preventDefault();
    if (submitting.current || !selectedIds.length) return;
    submitting.current = true;
    setBatchError(""); mutation.mutate({ personIds: selectedIds, role });
  }}>
    <SearchInput className="member-picker-search" value={keyword} onChange={setKeyword} disabled={mutation.isPending} placeholder="搜索姓名、岗位、登录名或拼音" autoFocus />
    <div className="member-picker-selection"><span>已选择 <strong>{selectedIds.length}</strong> 人</span>{selectedIds.length > 0 && <button type="button" disabled={mutation.isPending} onClick={() => { setSelectedPeople({}); setBatchError(""); }}>清空选择</button>}</div>
    <div className="member-candidate-list" aria-label="可添加人员">
      {candidatesQuery.isLoading && <LoadingState label="正在加载可添加人员…" className="member-picker-state" />}
      {candidatesQuery.isError && <div className="member-picker-state is-error"><strong>候选人员加载失败</strong><span>{candidatesQuery.error.message}</span><button type="button" className="compact-text-button" onClick={() => void candidatesQuery.refetch()}>重试</button></div>}
      {!candidatesQuery.isLoading && !candidatesQuery.isError && people.map((person) => <button
        type="button"
        className={`member-candidate-option${selectedPeople[person.id] ? " is-selected" : ""}`}
        aria-pressed={Boolean(selectedPeople[person.id])}
        key={person.id}
        disabled={!person.canAdd || mutation.isPending}
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
    <label className="field member-picker-role"><span>加入后的项目角色</span><select disabled={mutation.isPending} value={role} onChange={(event) => setRole(event.target.value as ProjectMemberRole)}><option value="member">项目成员</option><option value="viewer">项目观察者</option><option value="manager">项目经理</option></select></label>
    {batchError && <p className="form-error">部分成员添加失败：{batchError}</p>}
    <div className="form-actions"><button type="button" className="ghost-button" disabled={mutation.isPending} onClick={onClose}>取消</button><button className="primary-button" disabled={!selectedIds.length || mutation.isPending}>{mutation.isPending ? `正在添加 ${selectedIds.length} 人…` : `添加 ${selectedIds.length} 人到项目`}</button></div>
  </form></Modal>;
}
