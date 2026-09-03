import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Clock3,
  DatabaseBackup,
  ImagePlus,
  RefreshCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, jsonBody } from "../api";
import { useApp } from "../app-context";
import type {
  Backup,
  DatabaseIntegrityCheck,
  SystemBranding,
  SystemOverview,
} from "../types";
import { EmptyState, Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { BrandLogo, defaultBranding } from "../components/BrandLogo";

function formatStorageSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds = 0) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}天${hours}小时`;
  if (hours) return `${hours}小时${minutes}分钟`;
  return `${Math.max(1, minutes)}分钟`;
}

function relativeTime(value: string | null) {
  if (!value) return "尚未备份";
  const difference = Date.now() - new Date(value).getTime();
  if (difference < 60_000) return "刚刚";
  if (difference < 3_600_000) return `${Math.floor(difference / 60_000)}分钟前`;
  if (difference < 86_400_000) return `${Math.floor(difference / 3_600_000)}小时前`;
  return `${Math.floor(difference / 86_400_000)}天前`;
}

function BrandingSettingsCard() {
  const client = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [systemName, setSystemName] = useState(defaultBranding.systemName);
  const [shortName, setShortName] = useState(defaultBranding.shortName);
  const [logoDraft, setLogoDraft] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState("");
  const [localError, setLocalError] = useState("");
  const brandingQuery = useQuery({
    queryKey: ["branding"],
    queryFn: () => api<SystemBranding>("/api/branding"),
  });
  const branding = brandingQuery.data ?? defaultBranding;
  useEffect(() => {
    if (!brandingQuery.data) return;
    setSystemName(brandingQuery.data.systemName);
    setShortName(brandingQuery.data.shortName);
    setLogoDraft(undefined);
  }, [brandingQuery.data]);
  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { systemName, shortName };
      if (logoDraft !== undefined) payload.logoDataUrl = logoDraft;
      return api<SystemBranding>("/api/system/branding", { method: "PUT", body: jsonBody(payload) });
    },
    onSuccess: (result) => {
      client.setQueryData(["branding"], result);
      setLogoDraft(undefined);
      setMessage("品牌设置已保存");
      setLocalError("");
    },
  });
  const previewBranding: SystemBranding = {
    systemName: systemName.trim() || defaultBranding.systemName,
    shortName: shortName.trim() || defaultBranding.shortName,
    logoUrl: logoDraft === undefined ? branding.logoUrl : logoDraft,
    updatedAt: branding.updatedAt,
  };
  const selectLogo = (file?: File) => {
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
    const reader = new FileReader();
    reader.onload = () => setLogoDraft(String(reader.result || ""));
    reader.onerror = () => setLocalError("Logo读取失败，请重新选择");
    reader.readAsDataURL(file);
  };
  return <article className="panel system-detail-panel system-branding-panel">
    <header><div><h2>品牌设置</h2><p>统一侧边栏、登录界面和浏览器标签的系统标识</p></div></header>
    <div className="system-branding-content">
      <div className="system-branding-preview">
        <BrandLogo branding={previewBranding} />
        <div><strong>{previewBranding.systemName}</strong><span>展开与折叠状态使用同一Logo</span></div>
      </div>
      <form className="system-branding-form" onSubmit={(event) => { event.preventDefault(); setMessage(""); setLocalError(""); save.mutate(); }}>
        <label className="field"><span>系统名称</span><input value={systemName} maxLength={20} required onChange={(event) => setSystemName(event.target.value)} /></label>
        <label className="field"><span>系统简称</span><input value={shortName} maxLength={4} required onChange={(event) => setShortName(event.target.value)} /></label>
        <div className="system-branding-logo-field">
          <span>系统Logo</span>
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => selectLogo(event.target.files?.[0])} />
            <button type="button" className="ghost-button" onClick={() => fileRef.current?.click()}><ImagePlus size={15} />选择图片</button>
            {previewBranding.logoUrl && <button type="button" className="ghost-button" onClick={() => { setLogoDraft(null); if (fileRef.current) fileRef.current.value = ""; }}>移除Logo</button>}
          </div>
          <small>支持PNG、JPEG、WebP，最大512KB，建议使用正方形图片。</small>
        </div>
        {(localError || save.error) && <p className="form-error system-branding-feedback">{localError || save.error?.message}</p>}
        {message && <p className="system-operation-success system-branding-feedback"><ShieldCheck size={14} />{message}</p>}
        <div className="system-branding-actions">
          <button type="button" className="ghost-button" onClick={() => { setSystemName(defaultBranding.systemName); setShortName(defaultBranding.shortName); setLogoDraft(null); setMessage(""); setLocalError(""); }}>恢复默认值</button>
          <button className="primary-button" disabled={save.isPending || brandingQuery.isLoading}>{save.isPending ? "保存中…" : "保存品牌设置"}</button>
        </div>
      </form>
    </div>
  </article>;
}

export function SystemPage() {
  const { session, openLogin } = useApp();
  const client = useQueryClient();
  const [restoreTarget, setRestoreTarget] = useState<Backup>();
  const [feedback, setFeedback] = useState("");
  const overviewQuery = useQuery({
    queryKey: ["system-overview"],
    queryFn: () => api<SystemOverview>("/api/system/overview"),
    enabled: session.authenticated,
  });
  const backupsQuery = useQuery({
    queryKey: ["backups"],
    queryFn: () => api<Backup[]>("/api/backups"),
    enabled: session.authenticated,
  });
  const refreshSystemData = () => {
    void client.invalidateQueries({ queryKey: ["backups"] });
    void client.invalidateQueries({ queryKey: ["system-overview"] });
  };
  const backup = useMutation({
    mutationFn: () => api<Backup>("/api/backups", { method: "POST" }),
    onSuccess: (result) => {
      setFeedback(`备份已创建：${result.name}`);
      refreshSystemData();
    },
  });
  const restore = useMutation({
    mutationFn: (name: string) =>
      api<{ ok: boolean; message: string; safetyBackupName: string }>("/api/backups/restore", { method: "POST", body: jsonBody({ name }) }),
    onSuccess: (result) => setFeedback(result.message),
  });
  const deleteBackup = useMutation({
    mutationFn: (name: string) => api(`/api/backups/${encodeURIComponent(name)}`, { method: "DELETE" }),
    onSuccess: (_result, name) => {
      setFeedback(`备份已删除：${name}`);
      refreshSystemData();
    },
  });
  const integrityCheck = useMutation({
    mutationFn: () => api<DatabaseIntegrityCheck>("/api/system/database-check", { method: "POST" }),
  });
  const overview = overviewQuery.data;
  const backups = backupsQuery.data ?? [];
  const operationError = backup.error || deleteBackup.error || restore.error;
  if (!session.authenticated)
    return (
      <>
        <PageHeader title="系统管理" />
        <div className="page-content">
          <EmptyState
            title="登录后管理系统设置"
            detail="系统状态和数据库维护功能仅对管理员开放。"
            action={
              <button className="primary-button" onClick={openLogin}>
                用户登录
              </button>
            }
          />
        </div>
      </>
    );
  return (
    <>
      <PageHeader title="系统管理" />
      <div className="page-content">
        <div className="system-page">
          <section className="system-overview-grid" aria-label="系统概览">
            <article className="system-overview-card system-overview-running">
              <ShieldCheck size={22} />
              <div><span>运行状态</span><strong>{overview ? "运行正常" : overviewQuery.isLoading ? "读取中" : "状态未知"}</strong><small>{overview ? `已运行 ${formatUptime(overview.service.uptimeSeconds)}` : "等待系统响应"}</small></div>
            </article>
            <article className="system-overview-card">
              <DatabaseBackup size={22} />
              <div><span>数据库大小</span><strong>{overview ? formatStorageSize(overview.database.totalSizeBytes) : "—"}</strong><small>{overview ? `${overview.database.journalMode} 模式` : "包含数据库运行文件"}</small></div>
            </article>
            <article className={`system-overview-card ${overview?.backups.overdue ? "system-overview-warning" : ""}`}>
              <Clock3 size={22} />
              <div><span>最近备份</span><strong>{relativeTime(overview?.backups.lastCreatedAt ?? null)}</strong><small>{overview?.backups.overdue ? "已超过安全备份周期" : overview?.backups.lastCreatedAt ? new Date(overview.backups.lastCreatedAt).toLocaleString("zh-CN", { hour12: false }) : "请立即创建首份备份"}</small></div>
            </article>
            <article className="system-overview-card">
              <Archive size={22} />
              <div><span>备份空间</span><strong>{overview ? `${overview.backups.count} 份 · ${formatStorageSize(overview.backups.totalSizeBytes)}` : "—"}</strong><small>{overview ? `保留 ${overview.backups.retentionDays} 天，最多 ${overview.backups.maxCount} 份` : "读取备份策略"}</small></div>
            </article>
          </section>

          <article className="panel system-backup-panel">
          <header>
            <div>
              <h2>数据库备份与恢复</h2>
              <p>自动备份每天02:00执行；恢复前会先保存当前数据库</p>
            </div>
            <button
              className="primary-button"
              disabled={backup.isPending}
              onClick={() => { setFeedback(""); backup.mutate(); }}
            >
              <DatabaseBackup size={15} />
              {backup.isPending ? "正在备份…" : "立即备份"}
            </button>
          </header>
          <div className="system-backup-policy">
            <span>保留策略 <strong>{overview ? `${overview.backups.retentionDays}天 / ${overview.backups.maxCount}份` : "—"}</strong></span>
            <span>下次自动备份 <strong>{overview ? new Date(overview.backups.nextScheduledAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></span>
            {feedback && <span className="system-operation-success"><ShieldCheck size={14} />{feedback}</span>}
            {operationError && <span className="system-operation-error">{operationError.message}</span>}
          </div>
          <div className="system-backup-table-wrap">
            <table className="system-backup-table">
              <thead><tr><th>备份时间</th><th>文件名</th><th>大小</th><th>距今</th><th>操作</th></tr></thead>
              <tbody>
                {backups.map((item) => <tr key={item.name}>
                  <td>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</td>
                  <td><strong title={item.name}>{item.name}</strong></td>
                  <td>{formatStorageSize(item.size)}</td>
                  <td>{relativeTime(item.createdAt)}</td>
                  <td><div className="system-backup-actions">
                    <button className="inline-action-button" disabled={restore.isPending} onClick={() => { setFeedback(""); setRestoreTarget(item); }}><RefreshCcw size={14} />恢复</button>
                    <button className="inline-action-button danger" disabled={deleteBackup.isPending && deleteBackup.variables === item.name} onClick={() => confirm(`删除备份“${item.name}”？该操作无法恢复。`) && deleteBackup.mutate(item.name)}><Trash2 size={14} />{deleteBackup.isPending && deleteBackup.variables === item.name ? "删除中" : "删除"}</button>
                  </div></td>
                </tr>)}
              </tbody>
            </table>
            {backupsQuery.isLoading && <div className="system-table-state">正在读取备份…</div>}
            {!backupsQuery.isLoading && !backups.length && <EmptyState title="暂无备份" detail="可立即创建第一份备份。" />}
          </div>
          </article>

          <section className="system-secondary-grid">
            <article className="panel system-detail-panel">
              <header><div><h2>系统运行信息</h2><p>只读展示当前部署参数</p></div></header>
              <div className="system-detail-list">
                <div><span>应用版本</span><strong>v{overview?.service.version ?? "—"}</strong></div>
                <div><span>启动时间</span><strong>{overview ? new Date(overview.service.startedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</strong></div>
                <div><span>运行环境</span><strong>{overview?.service.environment ?? "—"}</strong></div>
                <div><span>时区</span><strong>{overview?.service.timezone ?? "—"}</strong></div>
                <div><span>监听地址</span><strong>{overview ? `${overview.service.host}:${overview.service.port}` : "—"}</strong></div>
                <div><span>数据库文件</span><strong title={overview?.database.path}>{overview?.database.path ?? "—"}</strong></div>
                <div><span>备份目录</span><strong title={overview?.database.backupDirectory}>{overview?.database.backupDirectory ?? "—"}</strong></div>
                <div className="http-alert"><ShieldCheck size={16} /><span>当前使用HTTP，仅限可信局域网访问</span></div>
              </div>
            </article>
            <article className="panel system-detail-panel system-check-panel">
              <header><div><h2>数据库健康检查</h2><p>检查SQLite结构和数据页，不修改业务数据</p></div><button className="ghost-button" disabled={integrityCheck.isPending} onClick={() => integrityCheck.mutate()}><ShieldCheck size={15} />{integrityCheck.isPending ? "检查中…" : "立即检查"}</button></header>
              <div className="system-check-content">
                <div className={`system-check-state ${integrityCheck.data ? integrityCheck.data.ok ? "is-success" : "is-error" : ""}`}>
                  <ShieldCheck size={30} />
                  <div><strong>{integrityCheck.data ? integrityCheck.data.ok ? "数据库状态正常" : "发现数据库异常" : "等待执行完整性检查"}</strong><span>{integrityCheck.data?.message ?? `当前使用 ${overview?.database.journalMode || "—"} 日志模式`}</span></div>
                </div>
                {integrityCheck.data && <dl className="system-check-meta"><div><dt>检查时间</dt><dd>{new Date(integrityCheck.data.checkedAt).toLocaleString("zh-CN", { hour12: false })}</dd></div><div><dt>检查耗时</dt><dd>{integrityCheck.data.durationMs} ms</dd></div></dl>}
                {integrityCheck.error && <p className="form-error">{integrityCheck.error.message}</p>}
              </div>
            </article>
            <BrandingSettingsCard />
          </section>
        </div>

        {restoreTarget && <Modal title="恢复数据库备份" width={600} closable={!restore.isPending} onClose={() => { if (!restore.isPending) setRestoreTarget(undefined); }}>
          <div className="system-restore-dialog">
            <div className="system-restore-warning"><RefreshCcw size={22} /><div><strong>恢复后当前数据库将被替换</strong><p>系统会先校验目标备份并自动备份当前数据，然后重启服务。</p></div></div>
            <dl><div><dt>备份文件</dt><dd title={restoreTarget.name}>{restoreTarget.name}</dd></div><div><dt>备份时间</dt><dd>{new Date(restoreTarget.createdAt).toLocaleString("zh-CN", { hour12: false })}</dd></div><div><dt>文件大小</dt><dd>{formatStorageSize(restoreTarget.size)}</dd></div></dl>
            {restore.error && <p className="form-error">{restore.error.message}</p>}
            {restore.data && <p className="system-operation-success"><ShieldCheck size={14} />{restore.data.message}</p>}
            <div className="form-actions"><button className="ghost-button" disabled={restore.isPending} onClick={() => setRestoreTarget(undefined)}>取消</button><button className="primary-button" disabled={restore.isPending || Boolean(restore.data)} onClick={() => restore.mutate(restoreTarget.name)}><RefreshCcw size={15} />{restore.isPending ? "正在校验并备份…" : restore.data ? "等待服务重启" : "确认恢复"}</button></div>
          </div>
        </Modal>}
      </div>
    </>
  );
}
