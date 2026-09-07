import { useCallback, useEffect, useState } from "react";
import type { Project, Session } from "./types";

type ProjectSelection = { accountKey: string; projectId: string };

const storageKeyFor = (accountKey: string) => `project-manage:selected-project:${accountKey}`;

/**
 * 项目选择状态机：按账号记忆所选项目（localStorage）、项目列表就绪后校验恢复、
 * 选择变化时持久化。从 App.tsx 抽离，保持行为一致。
 */
export function useProjectSelection({
  session,
  projects,
  enabled,
  projectsFetched,
}: {
  session: Session;
  projects: Project[];
  enabled: boolean;
  projectsFetched: boolean;
}) {
  const [selection, setSelection] = useState<ProjectSelection>({ accountKey: "", projectId: "" });
  const accountKey = enabled ? session.accountId || session.username || "authenticated" : "";
  const selectedProjectId = selection.accountKey === accountKey ? selection.projectId : "";

  useEffect(() => {
    if (!enabled) {
      setSelection((current) => (current.accountKey || current.projectId ? { accountKey: "", projectId: "" } : current));
      return;
    }
    if (!projectsFetched || !accountKey) return;
    setSelection((current) => {
      let storedProjectId = "";
      try { storedProjectId = window.localStorage.getItem(storageKeyFor(accountKey)) || ""; } catch { /* 使用当前选择或第一个可访问项目。 */ }
      const candidate = current.accountKey === accountKey ? current.projectId : storedProjectId;
      const projectId = projects.some((project) => project.id === candidate) ? candidate : projects[0]?.id || "";
      if (current.accountKey === accountKey && current.projectId === projectId) return current;
      return { accountKey, projectId };
    });
  }, [projects, enabled, projectsFetched, accountKey]);

  const projectSelectionReady = !enabled || Boolean(
    projectsFetched
    && selection.accountKey === accountKey
    && (!projects.length || projects.some((project) => project.id === selectedProjectId)),
  );

  useEffect(() => {
    if (!projectSelectionReady || !accountKey) return;
    const storageKey = storageKeyFor(accountKey);
    try {
      if (selectedProjectId) window.localStorage.setItem(storageKey, selectedProjectId);
      else window.localStorage.removeItem(storageKey);
    } catch { /* 存储不可用不影响本次页面的项目选择。 */ }
  }, [projectSelectionReady, selectedProjectId, accountKey]);

  const setSelectedProjectId = useCallback((projectId: string) => {
    if (!accountKey) return;
    setSelection((current) => (current.accountKey === accountKey && current.projectId === projectId
      ? current
      : { accountKey, projectId }));
  }, [accountKey]);

  return { selectedProjectId, setSelectedProjectId, projectSelectionReady };
}
