import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Plus } from "lucide-react";
import { ApiError, api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useProjects, useSession } from "../app-context";
import { invalidateProjectViews, keys } from "../query-keys";
import { ConfirmDialog } from "../components/Modal";
import { EmptyState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/Badge";
import { ProjectForm } from "../components/ManagementForms";
import { isAdmin } from "../permissions";
import type { Archives, Project } from "../types";

type ProjectArchiveInput = {
  id: string;
  name: string;
  expectedUpdatedAt: string;
  force?: boolean;
  expectedRequirements?: number;
  expectedIssues?: number;
};

export function ProjectsPage() {
  const { session } = useSession();
  const { projects, selectedProjectId } = useProjects();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string; expectedUpdatedAt: string } | null>(null);
  const [archiveConflict, setArchiveConflict] = useState<{ id: string; name: string; expectedUpdatedAt: string; requirements: number; issues: number } | null>(null);
  const [archiveError, setArchiveError] = useState("");
  const [archiveNeedsReopen, setArchiveNeedsReopen] = useState(false);
  const archiveSubmitting = useRef(false);
  const admin = isAdmin(session);
  const archive = useMutation({
    mutationFn: ({ id, expectedUpdatedAt, force = false, expectedRequirements, expectedIssues }: ProjectArchiveInput) => api(`/api/projects/${id}`, {
      method: "DELETE",
      body: jsonBody({ expectedUpdatedAt, ...(force ? { force: true, expectedRequirements, expectedIssues } : {}) }),
    }),
    onSuccess: () => {
      setArchiveTarget(null);
      setArchiveConflict(null);
      setArchiveError("");
      setArchiveNeedsReopen(false);
      invalidateProjectViews(client);
    },
    onError: async (error, input) => {
      if (!input.force && error instanceof ApiError && error.code === "DEPENDENCY_CONFLICT") {
        const details = error.details as { requirements?: number; issues?: number } | undefined;
        setArchiveConflict({ id: input.id, name: input.name, expectedUpdatedAt: input.expectedUpdatedAt, requirements: Number(details?.requirements || 0), issues: Number(details?.issues || 0) });
        setArchiveTarget(null);
        setArchiveError("");
        setArchiveNeedsReopen(false);
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
        setArchiveNeedsReopen(false);
        return;
      }
      if (isWriteOutcomeUnknown(error)) {
        try {
          const [latestProjects, latestArchives] = await Promise.all([
            api<Project[]>("/api/projects", { readOnly: true }),
            api<Archives>("/api/archives", { readOnly: true }),
          ]);
          client.setQueryData(keys.projects, latestProjects);
          client.setQueryData(keys.archives, latestArchives);
          if (!latestProjects.some((project) => project.id === input.id)
            && latestArchives.projects.some((project) => project.id === input.id)) {
            setArchiveTarget(null);
            setArchiveConflict(null);
            setArchiveError("");
            setArchiveNeedsReopen(false);
            invalidateProjectViews(client);
            return;
          }
        } catch {
          // 保留原始写入异常；活动列表与归档列表必须同时读回才能确认归档成功。
        }
      }
      if (requiresWriteRecheck(error)) {
        setArchiveNeedsReopen(true);
        invalidateProjectViews(client);
      }
      setArchiveError(error instanceof Error ? error.message : "项目归档失败");
    },
    onSettled: () => { archiveSubmitting.current = false; },
  });
  const submitArchive = (input: ProjectArchiveInput) => {
    if (archiveSubmitting.current) return;
    archiveSubmitting.current = true;
    archive.mutate(input);
  };
  return (
    <>
      <PageHeader
        title="项目管理"
        actions={admin ? (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <Plus size={16} />
            新建项目
          </button>
        ) : null}
      />
      <div className="page-content">
        <div className="table-panel project-table">
          <table>
            <thead><tr><th>项目</th><th>计划周期</th><th>状态</th>{session.authenticated && <th>操作</th>}</tr></thead>
            <tbody>
              {projects.map((project) => {
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
                        {admin && <button className="inline-action-button danger" disabled={archive.isPending} onClick={() => {
                          archive.reset();
                          setArchiveError("");
                          setArchiveNeedsReopen(false);
                          setArchiveTarget({ id: project.id, name: project.name, expectedUpdatedAt: project.updatedAt });
                        }}><Archive size={14} />归档</button>}
                      </div>
                    </td>
                  )}
                </tr>
              );})}
            </tbody>
          </table>
          {!projects.length && <EmptyState title="还没有项目" detail="创建第一个项目后即可维护需求和排期。" />}
        </div>
        {creating && (
          <ProjectForm onClose={() => setCreating(false)} />
        )}
        {archiveTarget && (() => {
          const current = projects.find((project) => project.id === archiveTarget.id);
          const changed = Boolean(current && current.updatedAt !== archiveTarget.expectedUpdatedAt);
          const invalidReason = !current
            ? "项目已不在当前列表，请关闭窗口后刷新确认。"
            : changed || archiveNeedsReopen
              ? "项目已更新，请关闭窗口后重新选择归档。"
              : "";
          return <ConfirmDialog title="归档项目" description={<>项目“<strong>{archiveTarget.name}</strong>”将从日常页面隐藏，之后可以在归档中心恢复。</>} confirmLabel={invalidReason ? "无法归档" : "确认归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(invalidReason)} error={invalidReason || archiveError} onClose={() => { setArchiveTarget(null); setArchiveError(""); setArchiveNeedsReopen(false); }} onConfirm={() => submitArchive({ ...archiveTarget })} />;
        })()}
        {archiveConflict && (() => {
          const current = projects.find((project) => project.id === archiveConflict.id);
          const changed = Boolean(current && current.updatedAt !== archiveConflict.expectedUpdatedAt);
          const invalidReason = !current
            ? "项目已不在当前列表，请关闭窗口后刷新确认。"
            : changed || archiveNeedsReopen
              ? "项目已更新，请关闭窗口后重新选择归档。"
              : "";
          return <ConfirmDialog title="确认强制归档" description={<div className="archive-project-confirmation"><p>项目“{archiveConflict.name}”仍有活跃内容：</p><div><strong>{archiveConflict.requirements}</strong><span>条活跃需求</span><strong>{archiveConflict.issues}</strong><span>条未解决问题</span></div><p>继续归档后，这些内容将随项目隐藏，恢复项目后仍可继续处理。</p></div>} confirmLabel={invalidReason ? "无法归档" : "仍然归档"} pendingLabel="归档中…" danger pending={archive.isPending} disabled={Boolean(invalidReason)} error={invalidReason || archiveError} onClose={() => { setArchiveConflict(null); setArchiveError(""); setArchiveNeedsReopen(false); }} onConfirm={() => submitArchive({ id: archiveConflict.id, name: archiveConflict.name, expectedUpdatedAt: archiveConflict.expectedUpdatedAt, force: true, expectedRequirements: archiveConflict.requirements, expectedIssues: archiveConflict.issues })} />;
        })()}
      </div>
    </>
  );
}
