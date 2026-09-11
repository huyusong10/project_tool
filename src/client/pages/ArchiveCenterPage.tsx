import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { usePageSearchParams, usePageScrollPosition } from '../use-page-view';
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { api, jsonBody, requiresWriteRecheck } from "../api";
import { invalidateArchiveViews, keys } from "../query-keys";
import type { Archives } from "../types";
import { matchesSearch } from "../../shared/search";
import { ConfirmDialog, TextPromptModal } from "../components/Modal";
import { EmptyState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { SearchInput } from "../components/SearchInput";
import { formatDateTime } from "../format";
import { useToast } from "../components/Toast";
import { useSession } from "../app-context";

const archiveEntityOptions = [
  { value: "projects", label: "项目" },
  { value: "requirements", label: "需求" },
  { value: "people", label: "人员" },
  { value: "templates", label: "模板" },
] as const;
type ArchiveEntity = (typeof archiveEntityOptions)[number]["value"];
type ArchiveRecheck = "restore" | "delete" | null;

function readArchiveRecheck(accountKey: string): ArchiveRecheck {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(`project-manage:archive-recheck:${accountKey}`);
    return value === "restore" || value === "delete" ? value : null;
  } catch {
    return null;
  }
}

function persistArchiveRecheck(accountKey: string, value: ArchiveRecheck) {
  if (typeof window === "undefined") return;
  try {
    const key = `project-manage:archive-recheck:${accountKey}`;
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // 页面状态仍会保留锁；存储不可用时只失去跨导航恢复能力。
  }
}

export function ArchiveCenterPage() {
  const client = useQueryClient();
  const toast = useToast();
  const { session } = useSession();
  const recheckAccountKey = session.accountId || session.username || "guest";
  const [filters, setFilters] = usePageSearchParams(['q','type'], true);
  const keyword = filters.get('q') || '', type = filters.get('type') || 'all';
  const updateFilter = (key: string, value: string) => setFilters(current => { const next = new URLSearchParams(current); next.set(key, value); next.set('page', '1'); return next; });
  const setKeyword = (value: string) => updateFilter('q', value), setType = (value: string) => updateFilter('type', value);
  const [deletePrompt, setDeletePrompt] = useState<{ entity: ArchiveEntity; id: string; title: string; impact: string; deletedAt: string } | null>(null);
  const [simpleDeleteTarget, setSimpleDeleteTarget] = useState<{ entity: ArchiveEntity; id: string; title: string; deletedAt: string } | null>(null);
  const [restoringKey, setRestoringKey] = useState<string | null>(null);
  const [archiveNeedsRecheck, setArchiveNeedsRecheckState] = useState<ArchiveRecheck>(() => readArchiveRecheck(recheckAccountKey));
  const setArchiveNeedsRecheck = (value: ArchiveRecheck) => {
    persistArchiveRecheck(recheckAccountKey, value);
    setArchiveNeedsRecheckState(value);
  };
  useEffect(() => {
    setArchiveNeedsRecheckState(readArchiveRecheck(recheckAccountKey));
  }, [recheckAccountKey]);
  const restoreSubmitting = useRef(false);
  const deleteSubmitting = useRef(false);
  const { data: archives, error, refetch, isFetching } = useQuery({ queryKey: keys.archives, queryFn: ({ signal }) => api<Archives>("/api/archives", { signal }) });
  const listUnavailable = Boolean(error && !archives);
  const rows = useMemo(() => archiveEntityOptions.flatMap(({ value, label }) =>
    (archives?.[value] || []).map((item) => ({ ...item, entity: value, typeLabel: label }))), [archives]);
  const filteredRows = useMemo(() => {
    return rows
      .filter((item) => type === "all" || item.entity === type)
      .filter((item) => matchesSearch([
        { text: item.title, weight: 100 },
        { text: item.jobTitle, weight: 20 },
        { text: item.typeLabel, pinyin: false },
      ], keyword))
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt) || left.id.localeCompare(right.id));
  }, [keyword, rows, type]);
  const restore = useMutation({
    mutationFn: ({ entity, id, expectedDeletedAt }: { entity: ArchiveEntity; id: string; expectedDeletedAt: string }) => api(`/api/${entity}/${id}/restore`, { method: "POST", body: jsonBody({ expectedDeletedAt }) }),
    onSuccess: () => {
      setArchiveNeedsRecheck(null);
      invalidateArchiveViews(client);
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await api<Archives>("/api/archives", { readOnly: true });
        client.setQueryData(keys.archives, latest);
        setArchiveNeedsRecheck(null);
        if (!latest[input.entity].some((item) => item.id === input.id)) {
          restore.reset();
          invalidateArchiveViews(client);
          toast.success("已核对最新状态：内容已移出归档列表");
        } else {
          restore.reset();
          toast.info("已核对最新状态：内容仍在归档中，可以重新操作");
        }
      } catch {
        setArchiveNeedsRecheck("restore");
      }
    },
    onSettled: () => {
      restoreSubmitting.current = false;
      setRestoringKey(null);
    },
  });
  const permanentlyDelete = useMutation({
    mutationFn: ({ entity, id, confirmName, expectedDeletedAt }: { entity: ArchiveEntity; id: string; confirmName?: string; expectedDeletedAt: string }) => api(`/api/archives/${entity}/${id}`, { method: "DELETE", body: jsonBody({ confirmName, expectedDeletedAt }) }),
    onSuccess: () => {
      setArchiveNeedsRecheck(null);
      setDeletePrompt(null);
      setSimpleDeleteTarget(null);
      invalidateArchiveViews(client);
    },
    onError: async (error, input) => {
      if (!requiresWriteRecheck(error)) return;
      try {
        const latest = await api<Archives>("/api/archives", { readOnly: true });
        client.setQueryData(keys.archives, latest);
        setArchiveNeedsRecheck(null);
        if (!latest[input.entity].some((item) => item.id === input.id)) {
          setDeletePrompt(null);
          setSimpleDeleteTarget(null);
          permanentlyDelete.reset();
          invalidateArchiveViews(client);
          toast.info("已核对最新状态：内容已不在归档列表，请到对应业务页面确认");
        } else {
          setDeletePrompt(null);
          setSimpleDeleteTarget(null);
          permanentlyDelete.reset();
          toast.info("已核对最新状态：内容仍在归档中，请重新选择删除");
        }
      } catch {
        setArchiveNeedsRecheck("delete");
      }
    },
    onSettled: () => { deleteSubmitting.current = false; },
  });
  const reloadArchives = async () => {
    const result = await refetch();
    if (result.error || !result.data) return;
    setArchiveNeedsRecheck(null);
    restore.reset();
    permanentlyDelete.reset();
    setDeletePrompt(null);
    setSimpleDeleteTarget(null);
  };
  const restoreArchive = (entity: ArchiveEntity, id: string, expectedDeletedAt: string) => {
    if (restoreSubmitting.current || archiveNeedsRecheck) return;
    restoreSubmitting.current = true;
    restore.reset();
    permanentlyDelete.reset();
    setRestoringKey(`${entity}:${id}`);
    restore.mutate({ entity, id, expectedDeletedAt });
  };
  const submitPermanentDelete = (input: { entity: ArchiveEntity; id: string; confirmName?: string; expectedDeletedAt: string }) => {
    if (deleteSubmitting.current || archiveNeedsRecheck) return;
    deleteSubmitting.current = true;
    permanentlyDelete.mutate(input);
  };
  const pagination = useListPagination({ items: filteredRows, filterKey: JSON.stringify([keyword, type]), personal: true, ready: Boolean(archives), loading: isFetching });
  usePageScrollPosition(Boolean(archives), true);
  return <>
    <PageHeader title="归档中心" />
    <div className="page-content">
      <section className="panel archive-panel paged-panel">
        <header><div><h2>已归档内容</h2><p>统一筛选、恢复或永久删除平台归档资源</p></div></header>
        <div className="archive-toolbar">
          <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索归档名称、岗位或拼音" />
          <select value={type} onChange={(event) => setType(event.target.value as "all" | ArchiveEntity)}><option value="all">全部类型</option>{archiveEntityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
          <span>{filteredRows.length} / {rows.length} 条</span>
        </div>
        {archiveNeedsRecheck && <div role="alert" className="warning-banner">{archiveNeedsRecheck === "restore" ? "归档恢复结果待核对" : "永久删除结果待核对"}，当前归档事实可能已变化，本页面不会重复提交。<button className="ghost-button" disabled={isFetching} onClick={() => void reloadArchives()}>{isFetching ? "读取中…" : "重新加载归档"}</button></div>}
        {error && archives && <div className="warning-banner">归档列表刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
        <div className="archive-table-wrap paged-body" ref={pagination.scrollRef}>
          <table className="archive-table">
            <thead><tr><th>名称</th><th>类型</th><th>补充信息</th><th>归档时间</th><th>操作</th></tr></thead>
            <tbody>{pagination.items.map((item) => {
              const rowKey = `${item.entity}:${item.id}`;
              const restoring = restoringKey === rowKey;
              return <tr key={`${item.entity}-${item.id}`}>
              <td><strong title={item.title}>{item.title}</strong></td>
              <td><span className={`archive-type archive-type-${item.entity}`}>{item.typeLabel}</span></td>
              <td>{item.jobTitle || "—"}</td>
              <td>{formatDateTime(item.deletedAt)}</td>
              <td><div className="archive-row-actions"><button className="inline-action-button" title={`恢复${item.typeLabel}`} disabled={Boolean(restoringKey) || permanentlyDelete.isPending || Boolean(archiveNeedsRecheck)} onClick={() => restoreArchive(item.entity, item.id, item.deletedAt)}><RotateCcw size={14} />{restoring ? "恢复中…" : "恢复"}</button><button className="inline-action-button danger" title={`永久删除${item.typeLabel}`} disabled={Boolean(restoringKey) || permanentlyDelete.isPending || Boolean(archiveNeedsRecheck)} onClick={() => {
                restore.reset();
                if (item.entity === "projects" || item.entity === "requirements") {
                  const impact = item.entity === "projects"
                    ? `将级联删除需求 ${item.requirementCount || 0} 条、工作项 ${item.workItemCount || 0} 条、问题 ${item.issueCount || 0} 条、流程 ${item.templateCount || 0} 个。`
                    : `将级联删除工作项 ${item.workItemCount || 0} 条、进展 ${item.progressCount || 0} 条；${item.linkedIssueCount || 0} 个关联问题会保留并转为项目公共问题。`;
                  permanentlyDelete.reset();
                  setDeletePrompt({ entity: item.entity, id: item.id, title: item.title, impact, deletedAt: item.deletedAt });
                  return;
                }
                permanentlyDelete.reset();
                setSimpleDeleteTarget({ entity: item.entity, id: item.id, title: item.title, deletedAt: item.deletedAt });
              }}><Trash2 size={14} />删除</button></div></td>
            </tr>})}</tbody>
          </table>
          {listUnavailable
            ? <EmptyState title="归档列表加载失败" detail={error?.message || "暂时无法读取归档数据。"} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} />
            : !filteredRows.length && <EmptyState title="没有符合条件的归档内容" detail={rows.length ? "调整搜索词或类型筛选后重试。" : "归档项目、需求、人员或流程后会显示在这里。"} />}
        </div>
        {(restore.error || permanentlyDelete.error) && <p className="form-error archive-error">{(restore.error || permanentlyDelete.error)?.message}</p>}
        <Pagination {...pagination.props} label="归档列表分页" />
      </section>
    </div>
    {deletePrompt && <TextPromptModal title={`永久删除${deletePrompt.entity === "projects" ? "项目" : "需求"}`} description={`${deletePrompt.impact}\n永久删除后无法恢复。`} label="输入完整名称确认" expectedValue={deletePrompt.title} confirmLabel="永久删除" danger pending={permanentlyDelete.isPending} blocked={archiveNeedsRecheck === "delete"} notice={archiveNeedsRecheck === "delete" ? <div className="warning-banner" role="alert">永久删除结果待核对，请重新加载归档后再操作。<button type="button" className="ghost-button" disabled={isFetching} onClick={() => void reloadArchives()}>{isFetching ? "读取中…" : "重新加载归档"}</button></div> : undefined} error={permanentlyDelete.error?.message} onClose={() => setDeletePrompt(null)} onConfirm={(confirmName) => submitPermanentDelete({ entity: deletePrompt.entity, id: deletePrompt.id, confirmName, expectedDeletedAt: deletePrompt.deletedAt })} />}
    {simpleDeleteTarget && <ConfirmDialog title="永久删除归档内容" description={<>“<strong>{simpleDeleteTarget.title}</strong>”将被永久删除，此操作无法恢复。{archiveNeedsRecheck === "delete" && <div className="warning-banner" role="alert">永久删除结果待核对，请重新加载归档后再操作。<button type="button" className="ghost-button" disabled={isFetching} onClick={() => void reloadArchives()}>{isFetching ? "读取中…" : "重新加载归档"}</button></div>}</>} confirmLabel="永久删除" pendingLabel="删除中…" danger pending={permanentlyDelete.isPending} disabled={archiveNeedsRecheck === "delete"} error={permanentlyDelete.error?.message} onClose={() => setSimpleDeleteTarget(null)} onConfirm={() => submitPermanentDelete({ entity: simpleDeleteTarget.entity, id: simpleDeleteTarget.id, expectedDeletedAt: simpleDeleteTarget.deletedAt })} />}
  </>;
}
