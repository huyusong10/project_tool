import { waitForServiceRestart } from '../features/system/restart';
import * as systemApi from '../features/system/api';
import { Button } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { usePageScrollPosition } from '../use-page-view';
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { Archive, Clock3, DatabaseBackup, Download, ImagePlus, RefreshCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useSession, useUiActions } from "../app-context";
import { invalidateAuditViews, invalidateSystemViews, keys } from "../query-keys";
import { formatBytes, formatUptime, relativeTime } from "../format";
import type { Backup, ImportedBackup, DatabaseIntegrityCheck, SystemBranding, SystemOverview } from "../types";
import { ConfirmDialog, Modal, useSynchronousPendingLock } from "../components/Modal";
import { EmptyState, LoadingState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { ApplicationModeCard } from '../features/system/ApplicationModeCard';
import { BrandLogo, defaultBranding } from "../components/BrandLogo";
import { useMinuteClock } from "../use-minute-clock";
import { canonicalizeLabel } from "../../shared/search";

type BrandingSaveInput = {
  systemName: string;
  shortName: string;
  expectedUpdatedAt: string | null;
  logoDataUrl?: string | null;
};

async function brandingMatchesInput(latest: SystemBranding, input: BrandingSaveInput) {
  if (latest.systemName !== canonicalizeLabel(input.systemName)
    || latest.shortName !== canonicalizeLabel(input.shortName)) return false;
  if (!Object.prototype.hasOwnProperty.call(input, "logoDataUrl")) return true;
  if (input.logoDataUrl === null) return latest.logoUrl === null;
  if (!input.logoDataUrl || !latest.logoUrl) return false;
  try {
    const [expected, actual] = await Promise.all([
      fetch(input.logoDataUrl).then((response) => response.arrayBuffer()),
      fetch(latest.logoUrl, { cache: "no-store", credentials: "same-origin" }).then((response) => {
        if (!response.ok) throw new Error("Logo读取失败");
        return response.arrayBuffer();
      }),
    ]);
    if (expected.byteLength !== actual.byteLength) return false;
    const expectedBytes = new Uint8Array(expected);
    const actualBytes = new Uint8Array(actual);
    return expectedBytes.every((value, index) => value === actualBytes[index]);
  } catch {
    return false;
  }
}

type RestoreReloadProbe = { controller: AbortController; task: Promise<boolean> };
let restoreReloadProbe: RestoreReloadProbe | null = null;
const SYSTEM_REFRESH_INTERVAL_MS = 60_000;
const BACKUP_OVERDUE_MS = 26 * 60 * 60 * 1000;
type MaintenanceRecheck = "backup" | "restore" | "delete" | null;

function readMaintenanceRecheck(accountKey: string): MaintenanceRecheck {
  if (typeof window === "undefined") return null;
  try {
    const value = window.sessionStorage.getItem(`project-manage:system-maintenance-recheck:${accountKey}`);
    return value === "backup" || value === "restore" || value === "delete" ? value : null;
  } catch {
    return null;
  }
}

function persistMaintenanceRecheck(accountKey: string, value: MaintenanceRecheck) {
  if (typeof window === "undefined") return;
  try {
    const key = `project-manage:system-maintenance-recheck:${accountKey}`;
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // 页面状态仍会保留锁；存储不可用时只失去跨导航恢复能力。
  }
}

function readBrandingRecheck(accountKey: string) {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(`project-manage:branding-recheck:${accountKey}`) === "1";
  } catch {
    return false;
  }
}

function persistBrandingRecheck(accountKey: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    const key = `project-manage:branding-recheck:${accountKey}`;
    if (value) window.sessionStorage.setItem(key, "1");
    else window.sessionStorage.removeItem(key);
  } catch {
    // 页面状态仍会保留锁；存储不可用时只失去跨导航恢复能力。
  }
}

function BrandingSettingsCard({ accountKey }: { accountKey: string }) {
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const logoReadVersion = useRef(0);
  const [readingLogo, setReadingLogo] = useState(false);
  const [systemName, setSystemName] = useState(defaultBranding.systemName);
  const [shortName, setShortName] = useState(defaultBranding.shortName);
  const [logoDraft, setLogoDraft] = useState<string | null | undefined>(undefined);
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  useEffect(() => () => { logoReadVersion.current += 1; }, []);
  const resetLogoRead = () => {
    logoReadVersion.current += 1;
    setReadingLogo(false);
    if (fileRef.current) fileRef.current.value = "";
  };
  const [saveNeedsRecheck, setSaveNeedsRecheckState] = useState(() => readBrandingRecheck(accountKey));
  const setSaveNeedsRecheck = (value: boolean) => {
    persistBrandingRecheck(accountKey, value);
    setSaveNeedsRecheckState(value);
  };
  const brandingQuery = useQuery({
    queryKey: keys.branding,
    queryFn: ({ signal }) => systemApi.branding<SystemBranding>({ signal }),
  });
  const branding = brandingQuery.data ?? defaultBranding;
  useEffect(() => {
    if (!brandingQuery.data || dirty) return;
    setSystemName(brandingQuery.data.systemName);
    setShortName(brandingQuery.data.shortName);
    setLogoDraft(undefined);
    setBaselineUpdatedAt(brandingQuery.data.updatedAt);
  }, [brandingQuery.data, dirty]);
  useEffect(() => {
    setSaveNeedsRecheckState(readBrandingRecheck(accountKey));
  }, [accountKey]);
  const stale = Boolean(dirty && brandingQuery.data && brandingQuery.data.updatedAt !== baselineUpdatedAt);
  const save = useMutation({
    mutationFn: (input: BrandingSaveInput) =>
      systemApi.systemBranding<SystemBranding>({ method: "PUT", body: jsonBody(input) }),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: keys.branding, exact: true });
      const query = client.getQueryCache().find({ queryKey: keys.branding, exact: true });
      return { query, data: query?.state.data } as { query: Query | undefined; data: unknown };
    },
    onSuccess: (result, _input, snapshot) => {
      setSaveNeedsRecheck(false);
      const currentQuery = client.getQueryCache().find({ queryKey: keys.branding, exact: true });
      const ownsCache = Boolean(snapshot?.query && currentQuery === snapshot.query && currentQuery.state.data === snapshot.data);
      const current = currentQuery?.state.data as SystemBranding | undefined;
      if (ownsCache) client.setQueryData(keys.branding, result);
      const displayed = ownsCache || !current ? result : current;
      setSystemName(displayed.systemName);
      setShortName(displayed.shortName);
      setBaselineUpdatedAt(displayed.updatedAt);
      invalidateAuditViews(client);
      setLogoDraft(undefined);
      setDirty(false);
      setMessage(ownsCache ? "品牌设置已保存" : "保存已完成，并已显示服务器最新设置");
      setLocalError("");
      void client.invalidateQueries({ queryKey: keys.branding });
    },
    onError: async (error, input) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latest = await systemApi.branding<SystemBranding>({ readOnly: true });
          client.setQueryData(keys.branding, latest);
          if (await brandingMatchesInput(latest, input)) {
            setSystemName(latest.systemName);
            setShortName(latest.shortName);
            setBaselineUpdatedAt(latest.updatedAt);
            setLogoDraft(undefined);
            setDirty(false);
            setSaveNeedsRecheck(false);
            setMessage("品牌设置已保存");
            setLocalError("");
            save.reset();
            invalidateAuditViews(client);
            void client.invalidateQueries({ queryKey: keys.branding });
            return;
          }
        } catch {
          // 保留原写入异常；品牌字段与 Logo 必须全部匹配才能确认保存成功。
        }
      }
      if (!requiresWriteRecheck(error)) return;
      setSaveNeedsRecheck(true);
      void client.invalidateQueries({ queryKey: keys.branding });
    },
  });
  const saveLock = useSynchronousPendingLock(save.isPending);
  const previewBranding: SystemBranding = {
    systemName: systemName.trim() || defaultBranding.systemName,
    shortName: shortName.trim() || defaultBranding.shortName,
    logoUrl: logoDraft === undefined ? branding.logoUrl : logoDraft,
    updatedAt: branding.updatedAt,
  };
  const selectLogo = (file?: File) => {
    resetLogoRead();
    const readVersion = logoReadVersion.current;
    setMessage("");
    setLocalError("");
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setLocalError("Logo仅支持PNG、JPEG或WebP图片");
      return;
    }
    if (file.size > 512 * 1024) {
      setLocalError("Logo文件不能超过512KB");
      return;
    }
    setDirty(true);
    setReadingLogo(true);
    const reader = new FileReader();
    reader.onload = () => {
      if (readVersion !== logoReadVersion.current) return;
      setLogoDraft(String(reader.result || ""));
      setReadingLogo(false);
    };
    reader.onerror = () => {
      if (readVersion !== logoReadVersion.current) return;
      setLocalError("Logo读取失败，请重新选择");
      setReadingLogo(false);
    };
    reader.readAsDataURL(file);
  };
  const loadLatestBranding = async () => {
    const result = await brandingQuery.refetch();
    if (result.error || !result.data) return;
    resetLogoRead();
    setSystemName(result.data.systemName); setShortName(result.data.shortName);
    setLogoDraft(undefined); setBaselineUpdatedAt(result.data.updatedAt); setDirty(false);
    setSaveNeedsRecheck(false); setMessage(""); setLocalError(""); save.reset();
  };
  return <article className="panel system-detail-panel system-branding-panel">
    <header><div><h2>品牌设置</h2><p>统一侧边栏、登录界面和浏览器标签的系统标识</p></div></header>
    {brandingQuery.isLoading && !brandingQuery.data ? <LoadingState label="正在加载品牌设置…" className="stable-panel-state" />
      : brandingQuery.error && !brandingQuery.data ? <EmptyState title="品牌设置加载失败" detail={brandingQuery.error.message || "暂时无法读取品牌设置，请稍后重试。"} action={<Button variant="secondary" className="ghost-button" disabled={brandingQuery.isFetching} onClick={() => void brandingQuery.refetch()}>重新加载</Button>} /> : <>
    {brandingQuery.error && <div className="warning-banner">品牌设置刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={brandingQuery.isFetching} onClick={() => void brandingQuery.refetch()}>重新加载</Button></div>}
    {saveNeedsRecheck ? <div className="warning-banner">保存结果需要核对，当前草稿不会再次提交。<Button busy={(brandingQuery.isFetching)} aria-label={brandingQuery.isFetching ? "读取中…" : "重新读取品牌设置"} variant="secondary" type="button" className="ghost-button" disabled={saveLock.busy || brandingQuery.isFetching} onClick={() => void loadLatestBranding()}>{"重新读取品牌设置"}</Button></div>
      : stale && <div className="warning-banner">服务器上的品牌设置已经更新，当前草稿保持不变。<Button busy={(brandingQuery.isFetching)} aria-label={brandingQuery.isFetching ? "读取中…" : "使用最新设置"} variant="secondary" type="button" className="ghost-button" disabled={saveLock.busy || brandingQuery.isFetching} onClick={() => void loadLatestBranding()}>{"使用最新设置"}</Button></div>}
    <div className="system-branding-content">
      <div className="system-branding-preview">
        <BrandLogo branding={previewBranding} />
        <div><strong>{previewBranding.systemName}</strong><span>展开与折叠状态使用同一Logo</span></div>
      </div>
      <form className="system-branding-form" onSubmit={(event) => { event.preventDefault(); if (stale || saveNeedsRecheck || readingLogo) return; saveLock.run(() => { setMessage(""); setLocalError(""); save.mutate({ systemName, shortName, expectedUpdatedAt: baselineUpdatedAt, ...(logoDraft !== undefined ? { logoDataUrl: logoDraft } : {}) }); }); }}>
        <label className="field"><span>系统名称</span><input value={systemName} pattern=".{1,20}" title="请输入1～20个字符" required disabled={saveLock.busy} onChange={(event) => { setSystemName(event.target.value); setDirty(true); setMessage(""); }} /></label>
        <label className="field"><span>系统简称</span><input value={shortName} pattern=".{1,4}" title="请输入1～4个字符" required disabled={saveLock.busy} onChange={(event) => { setShortName(event.target.value); setDirty(true); setMessage(""); }} /></label>
        <div className="system-branding-logo-field">
          <span>系统Logo</span>
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => selectLogo(event.target.files?.[0])} />
            <Button variant="secondary" type="button" className="ghost-button" disabled={saveLock.busy} onClick={() => fileRef.current?.click()}><ImagePlus size={15} />选择图片</Button>
            {previewBranding.logoUrl && <Button variant="secondary" type="button" className="ghost-button" disabled={saveLock.busy} onClick={() => { resetLogoRead(); setLogoDraft(null); setDirty(true); setMessage(""); }}>移除Logo</Button>}
          </div>
          <small>{readingLogo ? "正在读取图片…" : "支持PNG、JPEG、WebP，最大512KB，建议使用正方形图片。"}</small>
        </div>
        {(localError || save.error) && <p className="form-error system-branding-feedback">{localError || save.error?.message}</p>}
        {message && <p className="system-operation-success system-branding-feedback"><ShieldCheck size={14} />{message}</p>}
        <div className="system-branding-actions">
          <Button variant="secondary" type="button" className="ghost-button" disabled={saveLock.busy} onClick={() => { resetLogoRead(); setSystemName(defaultBranding.systemName); setShortName(defaultBranding.shortName); setLogoDraft(null); setDirty(true); setMessage(""); setLocalError(""); }}>恢复默认值</Button>
          <Button busy={(saveLock.busy)} aria-label={saveLock.busy ? "保存中…" : "保存品牌设置"} variant="primary" type="submit" className="primary-button" disabled={saveLock.busy || readingLogo || brandingQuery.isLoading || stale || saveNeedsRecheck}>{"保存品牌设置"}</Button>
        </div>
      </form>
    </div>
    </>}
  </article>;
}

export function SystemPage() {
  const { session } = useSession();
  const maintenanceAccountKey = session.accountId || session.username || "guest";
  const { openLogin } = useUiActions();
  const client = useQueryClient();
  const now = useMinuteClock();
  const [restoreTarget, setRestoreTarget] = useState<Backup | ImportedBackup>();
  const importTarget = restoreTarget && 'summary' in restoreTarget ? restoreTarget : undefined;
  const importing = Boolean(restoreTarget?.imported || importTarget);
  const importInput = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Backup>();
  const [feedback, setFeedback] = useState("");
  const [maintenanceRecheck, setMaintenanceRecheckState] = useState<MaintenanceRecheck>(() => readMaintenanceRecheck(maintenanceAccountKey));
  const setMaintenanceRecheck = (value: MaintenanceRecheck) => {
    persistMaintenanceRecheck(maintenanceAccountKey, value);
    setMaintenanceRecheckState(value);
  };
  const backupNeedsRecheck = maintenanceRecheck === "backup";
  const restoreNeedsRecheck = maintenanceRecheck === "restore";
  const deleteNeedsRecheck = maintenanceRecheck === "delete";
  const [restoreWaitError, setRestoreWaitError] = useState("");
  const [restoreWaitPending, setRestoreWaitPending] = useState(() => Boolean(restoreReloadProbe));
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const activeProbe = restoreReloadProbe;
    if (activeProbe) void activeProbe.task.then((restarted) => {
      if (!mounted.current || activeProbe.controller.signal.aborted) return;
      setRestoreWaitPending(false);
      if (!restarted) setRestoreWaitError("服务未在60秒内恢复，请手动刷新页面确认状态。");
    });
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setMaintenanceRecheckState(readMaintenanceRecheck(maintenanceAccountKey));
  }, [maintenanceAccountKey]);
  const overviewQuery = useQuery({
    queryKey: keys.systemOverview,
    queryFn: ({ signal }) => systemApi.systemOverview<SystemOverview>({ signal }),
    enabled: session.authenticated,
    refetchInterval: SYSTEM_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
  const backupsQuery = useQuery({
    queryKey: keys.backups,
    queryFn: ({ signal }) => systemApi.backups<Backup[]>({ signal }),
    enabled: session.authenticated,
    refetchInterval: SYSTEM_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: true,
  });
  const refreshSystemData = () => {
    invalidateSystemViews(client);
  };
  const startRestoreWait = (operationId?: string) => {
    setRestoreWaitError("");
    restoreReloadProbe?.controller.abort();
    const controller = new AbortController();
    const probe: RestoreReloadProbe = {
      controller,
      task: waitForServiceRestart(overviewQuery.data?.service.startedAt, operationId || "", controller.signal),
    };
    restoreReloadProbe = probe;
    setRestoreWaitPending(true);
    void probe.task.then((restarted) => {
      if (controller.signal.aborted) return;
      if (restoreReloadProbe === probe) restoreReloadProbe = null;
      if (restarted) window.location.reload();
      else if (mounted.current) {
        setRestoreWaitPending(false);
        setRestoreWaitError("服务未在60秒内恢复，请手动刷新页面确认状态。");
      }
    });
  };
  const download = useMutation({
    mutationFn: async (item: Backup) => {
      const blob = await systemApi.backupsDownloadQuery<Blob>(encodeURIComponent(item.name), encodeURIComponent(item.fingerprint), { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = item.name;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return item;
    },
    onSuccess: (item) => setFeedback(`下载已开始：${item.name}`),
  });
  const downloadLock = useSynchronousPendingLock(download.isPending);
  const upload = useMutation({
    mutationFn: (file: File) => systemApi.backupsImportQuery<ImportedBackup>(encodeURIComponent(file.name), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    }),
    onSuccess: (result) => {
      client.setQueryData<Backup[]>(keys.backups, (previous) => [result, ...(previous ?? []).filter((item) => item.name !== result.name)]);
      setRestoreTarget(result);
      setFeedback('文件已校验，请确认是否导入。取消后文件保留在备份列表。');
      refreshSystemData();
    },
    onError: (error) => {
      if (requiresWriteRecheck(error)) { setMaintenanceRecheck('backup'); refreshSystemData(); }
    },
  });
  const uploadLock = useSynchronousPendingLock(upload.isPending);
  const backup = useMutation({
    mutationFn: (_downloadAfter: boolean) => systemApi.backups<Backup>({ method: "POST" }),
    onSuccess: (result, downloadAfter) => {
      setMaintenanceRecheck(null);
      setFeedback(`备份已创建：${result.name}`);
      refreshSystemData();
      if (downloadAfter) downloadLock.run(() => download.mutate(result));
    },
    onError: (error) => {
      if (!requiresWriteRecheck(error)) return;
      setMaintenanceRecheck("backup");
      refreshSystemData();
    },
  });
  const backupLock = useSynchronousPendingLock(backup.isPending);
  const restore = useMutation({
    mutationFn: (backup: Backup | ImportedBackup) =>
      (backup.imported || 'summary' in backup ? systemApi.backupsImportRestore<{ ok: boolean; message: string; safetyBackupName: string; operationId: string }>({
        method: "POST", body: jsonBody({ name: backup.name, expectedFingerprint: backup.fingerprint }),
      }) : systemApi.backupsRestore<{ ok: boolean; message: string; safetyBackupName: string; operationId: string }>({
        method: "POST", body: jsonBody({ name: backup.name, expectedFingerprint: backup.fingerprint }),
      })),
    onSuccess: (result) => {
      setMaintenanceRecheck(null);
      setFeedback(result.message);
      startRestoreWait(result.operationId);
    },
    onError: (error) => {
      if (!requiresWriteRecheck(error)) return;
      setMaintenanceRecheck("restore");
      refreshSystemData();
      if (isWriteOutcomeUnknown(error)) {
        setFeedback("恢复请求结果暂时无法确认，正在检测服务是否已重启。");
        startRestoreWait();
      }
    },
  });
  const restoreLock = useSynchronousPendingLock(restore.isPending);
  const deleteBackup = useMutation({
    mutationFn: (backup: Backup) => systemApi.backupsById(encodeURIComponent(backup.name), {
      method: "DELETE", body: jsonBody({ expectedFingerprint: backup.fingerprint }),
    }),
    onSuccess: (_result, backup) => {
      setMaintenanceRecheck(null);
      setDeleteTarget(undefined);
      setFeedback(`备份已删除：${backup.name}`);
      refreshSystemData();
    },
    onError: async (error, backup) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latest = await systemApi.backups<Backup[]>({ readOnly: true });
          client.setQueryData(keys.backups, latest);
          if (!latest.some((item) => item.name === backup.name)) {
            setMaintenanceRecheck(null);
            setDeleteTarget(undefined);
            setFeedback(`备份已删除：${backup.name}`);
            deleteBackup.reset();
            refreshSystemData();
            return;
          }
        } catch {
          // 保留原写入异常；目标文件仍存在或列表读取失败时不能确认删除成功。
        }
      }
      if (!requiresWriteRecheck(error)) return;
      setMaintenanceRecheck("delete");
      refreshSystemData();
    },
  });
  const integrityCheck = useMutation({
    mutationFn: () => systemApi.systemDatabaseCheck<DatabaseIntegrityCheck>({ method: "POST", readOnly: true }),
  });
  const integrityPanel = useRef<HTMLElement>(null);
  const integrityLock = useSynchronousPendingLock(integrityCheck.isPending);
  const maintenanceBusy = backupLock.busy || restoreLock.busy || deleteBackup.isPending || restoreWaitPending || uploadLock.busy || downloadLock.busy;
  const maintenanceStateUnverified = !overviewQuery.data || Boolean(overviewQuery.error) || Boolean(backupsQuery.error);
  const maintenanceBlocked = maintenanceBusy || backupNeedsRecheck || restoreNeedsRecheck || deleteNeedsRecheck
    || maintenanceStateUnverified || overviewQuery.data?.lastRestore?.outcome === 'pending';
  const recheckBackups = async () => {
    const result = await backupsQuery.refetch();
    if (result.error || !result.data) return;
    setMaintenanceRecheck(null);
    backup.reset(); deleteBackup.reset(); upload.reset();
    if (deleteTarget) {
      const latest = result.data.find((item) => item.name === deleteTarget.name);
      // 不把已确认的危险操作自动改绑到同名新文件；原文件确实消失时关闭确认。
      if (!latest) setDeleteTarget(undefined);
    }
  };
  const recheckRestore = async () => {
    const result = await overviewQuery.refetch();
    if (result.error || !result.data) return;
    if (result.data.lastRestore?.outcome === 'pending') {
      setMaintenanceRecheck("restore");
      restore.reset();
      startRestoreWait(result.data.lastRestore.operationId);
      return;
    }
    setMaintenanceRecheck(null);
    restore.reset();
  };
  const clearMaintenanceFeedback = () => {
    restoreReloadProbe?.controller.abort();
    restoreReloadProbe = null;
    setRestoreWaitPending(false);
    setRestoreWaitError("");
    setFeedback("");
    setImportError('');
    upload.reset(); download.reset();
    backup.reset();
    restore.reset();
    deleteBackup.reset();
  };
  const overview = overviewQuery.data;
  const backups = backupsQuery.data ?? [];
  const backupsPagination = useListPagination({ items: backups, id: 'backups', personal: true, ready: Boolean(backupsQuery.data), loading: backupsQuery.isFetching });
  usePageScrollPosition(Boolean(backupsQuery.data && overviewQuery.data), true);
  const latestRestoreTarget = restoreTarget && backupsQuery.data
    ? backupsQuery.data.find((item) => item.name === restoreTarget.name)
    : undefined;
  const restoreTargetStale = Boolean(restoreTarget && backupsQuery.data
    && (!latestRestoreTarget || latestRestoreTarget.fingerprint !== restoreTarget.fingerprint));
  const latestDeleteTarget = deleteTarget && backupsQuery.data
    ? backupsQuery.data.find((item) => item.name === deleteTarget.name)
    : undefined;
  const deleteTargetStale = Boolean(deleteTarget && backupsQuery.data
    && (!latestDeleteTarget || latestDeleteTarget.fingerprint !== deleteTarget.fingerprint));
  const startedAt = overview ? new Date(overview.service.startedAt).getTime() : Number.NaN;
  const uptimeSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : overview?.service.uptimeSeconds;
  const lastBackupAt = overview?.backups.lastCreatedAt ? new Date(overview.backups.lastCreatedAt).getTime() : Number.NaN;
  const backupOverdue = Boolean(overview && (!Number.isFinite(lastBackupAt) || now - lastBackupAt > BACKUP_OVERDUE_MS));
  const operationError = backup.error || deleteBackup.error || restore.error || upload.error || download.error;
  if (!session.authenticated)
    return (
      <>
        <PageHeader title="系统管理" />
        <div className="page-content">
          <EmptyState
            title="登录后管理系统设置"
            detail="系统状态和数据库维护功能仅对管理员开放。"
            action={
              <Button variant="primary" className="primary-button" onClick={openLogin}>
                用户登录
              </Button>
            }
          />
        </div>
      </>
    );
  return (
    <>
      <PageHeader title="系统管理"
        actions={<Button variant="primary" className="primary-button" disabled={maintenanceBlocked} onClick={() => { if (!maintenanceBlocked) backupLock.run(() => { clearMaintenanceFeedback(); backup.mutate(false); }); }}>
          <DatabaseBackup size={15} />{backupLock.busy && !backup.variables ? "正在备份…" : "立即备份"}
        </Button>}
        moreActions={<>
          <Button variant="secondary" className="ghost-button" disabled={maintenanceBlocked} onClick={() => importInput.current?.click()}><Upload size={15} />{uploadLock.busy ? '正在上传并校验…' : '导入数据库'}</Button>
          <Button variant="secondary" className="ghost-button" disabled={maintenanceBlocked} onClick={() => { if (!maintenanceBlocked) backupLock.run(() => { clearMaintenanceFeedback(); backup.mutate(true); }); }}><Download size={15} />{backupLock.busy && backup.variables ? '正在导出…' : downloadLock.busy ? '正在下载…' : '导出数据库'}</Button>
          <Button busy={(integrityLock.busy)} aria-label={integrityLock.busy ? "检查中…" : "立即检查"} variant="secondary" className="ghost-button" disabled={integrityLock.busy} onClick={() => integrityLock.run(() => {
            integrityCheck.mutate();
            requestAnimationFrame(() => {
              integrityPanel.current?.scrollIntoView({ block: "center" });
              integrityPanel.current?.focus({ preventScroll: true });
            });
          })}><ShieldCheck size={15} />{"立即检查"}</Button>
        </>}/>
      <div className="page-content">
        <div className="system-page">
          {restoreWaitPending && !restoreTarget && <div className="warning-banner">数据库恢复已安排，服务重启后页面将自动刷新；其他维护操作暂不可用。</div>}
          {restoreNeedsRecheck && !restoreTarget && !restoreWaitPending && !restoreWaitError && <div className="warning-banner">数据库恢复结果需要核对，其他维护操作暂不可用。<Button busy={(overviewQuery.isFetching)} aria-label={overviewQuery.isFetching ? "读取中…" : "重新读取系统状态"} variant="secondary" type="button" className="ghost-button" disabled={overviewQuery.isFetching} onClick={() => void recheckRestore()}>{"重新读取系统状态"}</Button></div>}
          {restoreWaitError && !restoreTarget && <div className="warning-banner">{restoreWaitError}<Button variant="secondary" type="button" className="ghost-button" onClick={() => window.location.reload()}>立即刷新</Button></div>}
          {!restoreWaitPending && overview?.lastRestore?.outcome === 'succeeded' && <div className="system-operation-success"><ShieldCheck size={14} />最近一次数据库恢复已完成：{overview.lastRestore.backupName}（{new Date(overview.lastRestore.updatedAt).toLocaleString("zh-CN", { hour12: false })}）</div>}
          {!restoreWaitPending && overview?.lastRestore?.outcome === 'rolled_back' && <div className="warning-banner">{overview.lastRestore.message}。目标备份：{overview.lastRestore.backupName}{overview.lastRestore.failedDatabase ? `；失败库已保留为 ${overview.lastRestore.failedDatabase}` : ""}</div>}
          {!restoreWaitPending && overview?.lastRestore?.outcome === 'pending' && <div className="warning-banner">上次数据库恢复尚未确认结果，请检查服务日志后再执行新的恢复。</div>}
          {overviewQuery.error && <div className="warning-banner">系统概览{overview ? "刷新" : "加载"}失败，{overview ? "当前展示的是上次成功结果，维护操作暂不可用。" : "运行状态未确认，维护操作暂不可用。"}<Button variant="secondary" className="ghost-button" disabled={overviewQuery.isFetching} onClick={() => void overviewQuery.refetch()}>重新加载</Button></div>}
          <section className="system-overview-grid" aria-label="系统概览">
            <article className="system-overview-card system-overview-running">
              <ShieldCheck size={22} />
              <div><span>运行状态</span><strong>{overview ? "运行正常" : overviewQuery.isLoading ? "读取中" : "状态未知"}</strong><small>{overview ? `已运行 ${formatUptime(uptimeSeconds)}` : "等待系统响应"}</small></div>
            </article>
            <article className="system-overview-card">
              <DatabaseBackup size={22} />
              <div><span>数据库大小</span><strong>{overview ? formatBytes(overview.database.totalSizeBytes) : "—"}</strong><small>{overview ? `${overview.database.journalMode} 模式` : "包含数据库运行文件"}</small></div>
            </article>
            <article className={`system-overview-card ${backupOverdue ? "system-overview-warning" : ""}`}>
              <Clock3 size={22} />
              <div><span>最近备份</span><strong>{relativeTime(overview?.backups.lastCreatedAt ?? null, "尚未备份", now)}</strong><small>{backupOverdue ? "已超过安全备份周期" : overview?.backups.lastCreatedAt ? new Date(overview.backups.lastCreatedAt).toLocaleString("zh-CN", { hour12: false }) : "请立即创建首份备份"}</small></div>
            </article>
            <article className="system-overview-card">
              <Archive size={22} />
              <div><span>备份空间</span><strong>{overview ? `${overview.backups.count} 份 · ${formatBytes(overview.backups.totalSizeBytes)}` : "—"}</strong><small>{overview ? overview.backups.restorableCount < overview.backups.count ? `${overview.backups.restorableCount} 份可恢复，请检查异常文件` : `保留 ${overview.backups.retentionDays} 天，最多 ${overview.backups.maxCount} 份` : "读取备份策略"}</small></div>
            </article>
          </section>

          <article className="panel system-backup-panel paged-panel">
          <header>
            <div>
              <h2>数据库备份与恢复</h2>
              <p>自动备份每天02:00执行；恢复前会先保存当前数据库</p>
            </div>
            <div className="system-database-toolbar">
            <input ref={importInput} type="file" accept=".db" aria-label="选择数据库文件" hidden disabled={maintenanceBlocked} onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file || maintenanceBlocked) return;
              clearMaintenanceFeedback();
              if (!file.name.toLowerCase().endsWith('.db') || !file.size) { setImportError('请选择非空的 .db 数据库文件'); return; }
              const maxBytes = overview?.database.importMaxBytes ?? 512 * 1024 * 1024;
              if (file.size > maxBytes) { setImportError(`数据库文件不能超过 ${formatBytes(maxBytes)}`); return; }
              uploadLock.run(() => upload.mutate(file));
            }} />
            </div>
          </header>
          <div className="system-backup-policy">
            <span>保留策略 <strong>{overview ? `${overview.backups.retentionDays}天 / ${overview.backups.maxCount}份` : "—"}</strong></span>
            <span>下次自动备份 <strong>{overview ? new Date(overview.backups.nextScheduledAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></span>
            {feedback && <span className="system-operation-success"><ShieldCheck size={14} />{feedback}</span>}
            {operationError && <span className="system-operation-error">{operationError.message}</span>}
            {importError && <span className="system-operation-error" role="alert">{importError}</span>}
            {(backupNeedsRecheck || deleteNeedsRecheck) && <Button busy={(backupsQuery.isFetching)} aria-label={backupsQuery.isFetching ? "读取中…" : "重新读取备份列表"} variant="secondary" type="button" className="ghost-button" disabled={backupsQuery.isFetching} onClick={() => void recheckBackups()}>{"重新读取备份列表"}</Button>}
          </div>
          <div className="system-backup-table-wrap paged-body" ref={backupsPagination.scrollRef}>
            {backupsQuery.error && backupsQuery.data && <div className="warning-banner">备份列表刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={backupsQuery.isFetching} onClick={() => void backupsQuery.refetch()}>重新加载</Button></div>}
            {backupsQuery.data && <table className="system-backup-table">
              <thead><tr><th>备份／上传时间</th><th>文件名</th><th>大小</th><th>距今</th><th>操作</th></tr></thead>
              <tbody>
                {backupsPagination.items.map((item) => <tr key={item.name}>
                  <td data-label="备份／上传时间">{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                  <td><strong title={item.name}>{item.name}</strong>{item.restorable === false && <small className="system-backup-file-error" title={item.validationError ?? undefined}>不可恢复：{item.validationError || "文件校验失败"}</small>}</td>
                  <td data-label="大小">{formatBytes(item.size)}</td>
                  <td data-label="距今">{relativeTime(item.createdAt, "尚未备份", now)}</td>
                  <td><div className="system-backup-actions">
                    <Button variant="secondary" size="small" className="inline-action-button" disabled={maintenanceBlocked} onClick={() => { if (!maintenanceBlocked) downloadLock.run(() => { clearMaintenanceFeedback(); download.mutate(item); }); }}><Download size={14} />下载</Button>
                    <Button variant="secondary" size="small" className="inline-action-button" disabled={maintenanceBlocked || item.restorable === false} title={item.restorable === false ? item.validationError || "该文件不能恢复" : undefined} onClick={() => { if (maintenanceBlocked || item.restorable === false) return; clearMaintenanceFeedback(); setRestoreTarget(item); }}><RefreshCcw size={14} />恢复</Button>
                    <Button busy={(deleteBackup.isPending && deleteBackup.variables?.name === item.name)} aria-label={deleteBackup.isPending && deleteBackup.variables?.name === item.name ? "删除中" : "删除"} variant="ghost" tone="danger" size="small" className="inline-action-button danger" disabled={maintenanceBlocked} onClick={() => { if (maintenanceBlocked) return; clearMaintenanceFeedback(); setDeleteTarget(item); }}><Trash2 size={14} />{"删除"}</Button>
                  </div></td>
                </tr>)}
              </tbody>
            </table>}
            {backupsQuery.isLoading && !backupsQuery.data && <LoadingState className="system-table-state" label="正在读取备份…" />}
            {backupsQuery.error && !backupsQuery.data && <EmptyState title="备份列表加载失败" detail={backupsQuery.error.message || "暂时无法读取备份，请稍后重试。"} action={<Button variant="secondary" className="ghost-button" disabled={backupsQuery.isFetching} onClick={() => void backupsQuery.refetch()}>重新加载</Button>} />}
            {backupsQuery.data && !backups.length && <EmptyState title="暂无备份" detail="可立即创建第一份备份。" />}
          </div>
            <Pagination {...backupsPagination.props} label="备份列表分页" />
          </article>

          <section className="system-secondary-grid">
            <article className="panel system-detail-panel">
              <header><div><h2>系统运行信息</h2><p>运行日志用于排查请求失败；业务变更在操作审计中查询</p></div></header>
              <div className="system-detail-list">
                <div><span>应用版本</span><strong>v{overview?.service.version ?? "—"}</strong></div>
                <div><span>启动时间</span><strong>{overview ? new Date(overview.service.startedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></div>
                <div><span>运行环境</span><strong>{overview?.service.environment ?? "—"}</strong></div>
                <div><span>时区</span><strong>{overview?.service.timezone ?? "—"}</strong></div>
                <div><span>监听地址</span><strong>{overview ? `${overview.service.host}:${overview.service.port}` : "—"}</strong></div>
                <div><span>数据库文件</span><strong title={overview?.database.path}>{overview?.database.path ?? "—"}</strong></div>
                <div><span>备份目录</span><strong title={overview?.database.backupDirectory}>{overview?.database.backupDirectory ?? "—"}</strong></div>
                <div><span>运行日志目录</span><strong className="system-log-path">{overview?.logging ? overview.logging.directory ?? "未启用文件日志，请查看服务进程输出" : "—"}</strong></div>
                <div><span>日志级别</span><strong>{overview?.logging?.level.toUpperCase() ?? "—"}</strong></div>
                <div className="http-alert"><ShieldCheck size={16} /><span>当前使用HTTP，仅限可信局域网访问</span></div>
              </div>
            </article>
            <article ref={integrityPanel} tabIndex={-1} aria-label="数据库健康检查" className="panel system-detail-panel system-check-panel">
              <header><div><h2>数据库健康检查</h2><p>检查SQLite结构和数据页，不修改业务数据</p></div></header>
              <div className="system-check-content" role="status" aria-live="polite">
                <div className={`system-check-state ${integrityLock.busy ? "" : integrityCheck.error ? "is-error" : integrityCheck.data ? integrityCheck.data.ok ? "is-success" : "is-error" : ""}`}>
                  <ShieldCheck size={30} />
                  <div><strong>{integrityLock.busy ? "正在检查数据库…" : integrityCheck.error ? "本次检查未完成" : integrityCheck.data ? integrityCheck.data.ok ? "数据库状态正常" : "发现数据库异常" : "等待执行完整性检查"}</strong><span>{integrityLock.busy ? "正在校验SQLite结构和数据页，请稍候。" : integrityCheck.error?.message ?? integrityCheck.data?.message ?? `当前使用 ${overview?.database.journalMode || "—"} 日志模式`}</span></div>
                </div>
                {!integrityLock.busy && !integrityCheck.error && integrityCheck.data && <dl className="system-check-meta"><div><dt>检查时间</dt><dd>{new Date(integrityCheck.data.checkedAt).toLocaleString("zh-CN", { hour12: false })}</dd></div><div><dt>检查耗时</dt><dd>{integrityCheck.data.durationMs} ms</dd></div></dl>}
              </div>
            </article>
            <ApplicationModeCard />
            <BrandingSettingsCard accountKey={maintenanceAccountKey} />
          </section>
        </div>

        {restoreTarget && <Modal title={importing ? '导入数据库' : '恢复数据库备份'} width={600} closable={!restoreLock.busy && !restore.data} onClose={() => { if (restoreLock.canClose() && !restore.data) setRestoreTarget(undefined); }}>
          <div className="system-restore-dialog">
            <div className="system-restore-warning"><RefreshCcw size={22} /><div><strong>{importing ? '导入' : '恢复'}后当前数据库将被替换</strong><p>系统会先校验目标备份并自动备份当前数据，然后重启服务。</p></div></div>
            <dl><div><dt>备份文件</dt><dd title={restoreTarget.name}>{restoreTarget.name}</dd></div><div><dt>{importing ? '上传时间' : '备份时间'}</dt><dd>{new Date(restoreTarget.createdAt).toLocaleString("zh-CN", { hour12: false })}</dd></div><div><dt>文件大小</dt><dd>{formatBytes(restoreTarget.size)}</dd></div></dl>
            {importTarget && <>
              <dl><div><dt>本地文件</dt><dd title={importTarget.originalName}>{importTarget.originalName}</dd></div><div><dt>数据数量</dt><dd>{importTarget.summary.projects} 个项目 · {importTarget.summary.requirements} 条需求 · {importTarget.summary.people} 名人员（含归档）</dd></div></dl>
            </>}
            {importing && <p className="system-import-note">导入将替换本机全部业务数据、账号和系统设置。admin 使用本机配置的管理员密码，其他账号保留导入文件中的密码。导入后所有用户需要重新登录。</p>}
            {restoreTargetStale && <p className="form-error" role="alert">备份文件已被后台删除或替换，请关闭窗口并从最新列表重新选择。</p>}
            {backupsQuery.error && <div className="warning-banner" role="alert">备份列表刷新失败，当前文件状态未确认。<Button busy={(backupsQuery.isFetching)} aria-label={backupsQuery.isFetching ? "读取中…" : "重新读取备份列表"} variant="secondary" type="button" className="ghost-button" disabled={backupsQuery.isFetching} onClick={() => void recheckBackups()}>{"重新读取备份列表"}</Button></div>}
            {restore.error && <p className="form-error">{restore.error.message}</p>}
            {restoreNeedsRecheck && <div className="warning-banner">恢复结果需要核对，当前备份不会再次提交。{!restoreWaitPending && <Button busy={(overviewQuery.isFetching)} aria-label={overviewQuery.isFetching ? "读取中…" : "重新读取系统状态"} variant="secondary" type="button" className="ghost-button" disabled={overviewQuery.isFetching} onClick={() => void recheckRestore()}>{"重新读取系统状态"}</Button>}</div>}
            {restore.data && <p className="system-operation-success"><ShieldCheck size={14} />{restore.data.message}</p>}
            {restore.data && !restoreWaitError && <p>服务恢复后页面会自动刷新并重新校验当前账号权限。</p>}
            {restoreWaitError && <p className="form-error">{restoreWaitError} <Button variant="secondary" type="button" className="ghost-button" onClick={() => window.location.reload()}>立即刷新</Button></p>}
            <div className="form-actions"><Button variant="secondary" className="ghost-button" disabled={restoreLock.busy || Boolean(restore.data)} onClick={() => { if (restoreLock.canClose() && !restore.data) setRestoreTarget(undefined); }}>取消</Button><Button variant="primary" className="primary-button" disabled={maintenanceBlocked || restoreTargetStale || Boolean(restore.data)} onClick={() => { if (maintenanceBlocked || restoreTargetStale || restore.data) return; restoreLock.run(() => restore.mutate(restoreTarget)); }}><RefreshCcw size={15} />{restoreLock.busy ? "正在校验并备份…" : restore.data ? "等待服务重启" : restoreNeedsRecheck ? "等待核对" : importing ? '确认导入并替换' : "确认恢复"}</Button></div>
          </div>
        </Modal>}
        {deleteTarget && <ConfirmDialog title="删除数据库备份" description={<><p>备份“<strong>{deleteTarget.name}</strong>”将被永久删除，删除后无法用于数据库恢复。</p>{deleteTargetStale && <p className="form-error" role="alert">备份文件已被后台删除或替换，请关闭窗口并从最新列表重新选择。</p>}{(backupsQuery.error || deleteNeedsRecheck) && <div className="warning-banner" role="alert">{backupsQuery.error ? "备份列表刷新失败，当前文件状态未确认。" : "删除结果需要核对，当前备份不会再次提交。"}<Button busy={(backupsQuery.isFetching)} aria-label={backupsQuery.isFetching ? "读取中…" : "重新读取备份列表"} variant="secondary" type="button" className="ghost-button" disabled={backupsQuery.isFetching} onClick={() => void recheckBackups()}>{"重新读取备份列表"}</Button></div>}</>} confirmLabel="永久删除" pendingLabel="删除中…" danger pending={deleteBackup.isPending} disabled={maintenanceBlocked || deleteTargetStale} error={deleteBackup.error?.message} onClose={() => setDeleteTarget(undefined)} onConfirm={() => { if (!maintenanceBlocked && !deleteTargetStale) deleteBackup.mutate(deleteTarget); }} />}
      </div>
    </>
  );
}
