import { Button } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { useListPagination } from '../use-list-pagination';
import { usePageScrollPosition } from '../use-page-view';
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleUserRound, Copy, KeyRound, PlugZap, Plus, ShieldCheck } from "lucide-react";
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../api";
import { useProjects, useSession, useUiActions } from "../app-context";
import { invalidateTokenViews, keys } from "../query-keys";
import type { ApiToken } from "../types";
import { ConfirmDialog, Modal, useSynchronousPendingLock } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { FormError, FormField, FormSubmitActions } from "../components/Form";
import { LoadingState } from "../components/Feedback";
import { copyText as writeClipboardText } from "../clipboard";
import { useMinuteClock } from "../use-minute-clock";

type TokenRecheckKind = "create" | "revoke";

function tokenRecheckStorageKey(accountId: string) {
  return `project-manage:token-recheck:${accountId}`;
}

function readTokenRecheck(accountId: string): TokenRecheckKind | null {
  try {
    const value = window.sessionStorage.getItem(tokenRecheckStorageKey(accountId));
    return value === "create" || value === "revoke" ? value : null;
  } catch { return null; }
}

function persistTokenRecheck(accountId: string, kind: TokenRecheckKind | null) {
  try {
    const key = tokenRecheckStorageKey(accountId);
    if (kind) window.sessionStorage.setItem(key, kind);
    else window.sessionStorage.removeItem(key);
  } catch { /* 浏览器禁用会话存储时仍保留当前页面的内存锁。 */ }
}

export function PersonalSettingsPage() {
  const { session } = useSession();
  const { projects } = useProjects();
  const { openPassword } = useUiActions();
  const client = useQueryClient();
  const now = useMinuteClock();
  const tokenScope = session.accountId || session.username || "guest";
  const [initialTokenRecheck] = useState(() => readTokenRecheck(tokenScope));
  const [tokenModal, setTokenModal] = useState(false);
  const [newToken, setNewToken] = useState<string>();
  const [createNeedsRecheck, setCreateNeedsRecheck] = useState(initialTokenRecheck === "create");
  const [recheckingTokens, setRecheckingTokens] = useState(false);
  const [copied, setCopied] = useState<"endpoint" | "token" | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);
  const [revokeNeedsRecheck, setRevokeNeedsRecheck] = useState(initialTokenRecheck === "revoke");
  const tokensQuery = useQuery({ queryKey: [...keys.myTokens, tokenScope], queryFn: ({ signal }) => api<ApiToken[]>("/api/tokens", { signal }) });
  const tokens = tokensQuery.data || [];
  const setTokenRecheck = (kind: TokenRecheckKind | null) => {
    persistTokenRecheck(tokenScope, kind);
    setCreateNeedsRecheck(kind === "create");
    setRevokeNeedsRecheck(kind === "revoke");
  };
  const createToken = useMutation({
    mutationFn: (input: object) => api<ApiToken & { token: string }>("/api/tokens", { method: "POST", body: jsonBody(input) }),
    onMutate: () => persistTokenRecheck(tokenScope, "create"),
    onSuccess: (result) => { setTokenRecheck(null); setNewToken(result.token); setCopied(null); invalidateTokenViews(client); },
    onError: (error) => {
      if (!requiresWriteRecheck(error)) { setTokenRecheck(null); return; }
      setTokenRecheck("create");
      invalidateTokenViews(client);
    },
  });
  const createLock = useSynchronousPendingLock(createToken.isPending);
  const revoke = useMutation({
    mutationFn: (id: string) => api("/api/tokens/" + id, { method: "DELETE" }),
    onMutate: () => persistTokenRecheck(tokenScope, "revoke"),
    onSuccess: () => {
      setTokenRecheck(null);
      setRevokeTarget(null);
      invalidateTokenViews(client);
    },
    onError: async (error, id) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latest = await api<ApiToken[]>("/api/tokens", { readOnly: true });
          client.setQueryData([...keys.myTokens, tokenScope], latest);
          if (latest.find((token) => token.id === id)?.revokedAt) {
            setTokenRecheck(null);
            setRevokeTarget(null);
            revoke.reset();
            invalidateTokenViews(client);
            return;
          }
        } catch {
          // 保留原写入异常与跨刷新锁；Token 必须仍可见且带撤销时间才能确认成功。
        }
      }
      if (!requiresWriteRecheck(error)) { setTokenRecheck(null); return; }
      setTokenRecheck("revoke");
      invalidateTokenViews(client);
    },
  });
  const mcpEndpoint = `${window.location.origin}/mcp`;
  const roleLabel = session.globalRole === "admin"
    ? "系统管理员"
    : projects.some((project) => project.projectRole === "manager")
      ? "项目经理"
      : projects.some((project) => project.projectRole === "member")
        ? "项目成员"
        : projects.some((project) => project.projectRole === "viewer")
          ? "项目观察者"
          : "暂未分配项目";
  const activeTokens = tokens.filter((token) => !token.revokedAt && (!token.expiresAt || new Date(token.expiresAt).getTime() > now));
  const tokenListNeedsRecheck = createNeedsRecheck || revokeNeedsRecheck;
  const orderedTokens = [...tokens].sort((left, right) => {
    const leftInactive = Boolean(left.revokedAt || (left.expiresAt && new Date(left.expiresAt).getTime() <= now));
    const rightInactive = Boolean(right.revokedAt || (right.expiresAt && new Date(right.expiresAt).getTime() <= now));
    return Number(leftInactive) - Number(rightInactive) || right.createdAt.localeCompare(left.createdAt);
  });
  const pagination = useListPagination({ items: orderedTokens, id: 'tokens', personal: true, ready: Boolean(tokensQuery.data), loading: tokensQuery.isFetching });
  usePageScrollPosition(Boolean(tokensQuery.data), true);
  const copyText = async (value: string, target: "endpoint" | "token") => {
    setCopied(await writeClipboardText(value) ? target : null);
  };
  const openTokenModal = () => {
    if (tokenListNeedsRecheck) return;
    createToken.reset();
    setNewToken(undefined);
    setCopied(null);
    setTokenModal(true);
  };
  const closeTokenModal = () => {
    if (createLock.canClose()) setTokenModal(false);
  };
  const recheckTokenList = async () => {
    if (recheckingTokens) return;
    setRecheckingTokens(true);
    try {
      const result = await tokensQuery.refetch();
      if (result.error || !result.data) return;
      setTokenRecheck(null);
      setRevokeTarget(null);
      setTokenModal(false);
      createToken.reset();
      revoke.reset();
    } finally { setRecheckingTokens(false); }
  };
  return <>
    <PageHeader title="个人设置" actions={<Button variant="primary" className="primary-button" aria-label={tokens.length?"创建 Token":"创建第一个 Token"} disabled={!tokensQuery.data||tokenListNeedsRecheck} onClick={openTokenModal}><Plus size={15} />创建 Token</Button>} secondaryActions={<Button variant="secondary" className="ghost-button" onClick={openPassword}><KeyRound size={15} />修改密码</Button>} />
    <div className="page-content personal-settings-page">
      <section className="panel personal-account-panel">
        <div className="personal-account-identity"><span>{session.username?.slice(0, 1).toUpperCase() || "用"}</span><div><h2>{session.username}</h2><p><CircleUserRound size={14} />{session.personId ? "已关联业务人员" : "当前账号未关联业务人员"}</p></div></div>
        <dl className="personal-account-facts">
          <div><dt>最高权限</dt><dd>{roleLabel}</dd></div>
          <div><dt>可访问项目</dt><dd>{projects.length} 个</dd></div>
          <div><dt>MCP 权限</dt><dd>随账号权限同步</dd></div>
        </dl>
      </section>
      <section className="panel personal-mcp-panel">
        <header><div><h2>MCP 接入</h2><p>为本机客户端创建独立凭据，Token 自动继承当前账号的项目权限</p></div></header>
        <div className="personal-mcp-connection">
          <span className="personal-mcp-icon"><PlugZap size={20} /></span>
          <div><span>MCP 服务地址</span><code>{mcpEndpoint}</code><small>客户端通过 Authorization: Bearer Token 连接</small></div>
          <Button variant="secondary" className="ghost-button" onClick={() => void copyText(mcpEndpoint, "endpoint")}><Copy size={15} />{copied === "endpoint" ? "已复制" : "复制地址"}</Button>
        </div>
        {tokensQuery.isLoading && !tokensQuery.data && <LoadingState label="正在加载 Token…" className="personal-token-loading" />}
        {tokensQuery.error && !tokensQuery.data && <div className="personal-token-error"><span>{tokensQuery.error.message}</span><Button variant="secondary" className="ghost-button" disabled={tokensQuery.isFetching} onClick={() => void tokensQuery.refetch()}>重新加载</Button></div>}
        {tokensQuery.error && tokensQuery.data && <div className="warning-banner">Token 列表刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={tokensQuery.isFetching} onClick={() => void tokensQuery.refetch()}>重新加载</Button></div>}
        {tokenListNeedsRecheck && <div className="warning-banner">Token 操作结果需要核对，创建和撤销暂不可用。<Button busy={(recheckingTokens)} aria-label={recheckingTokens ? "读取中…" : "重新读取 Token 列表"} variant="secondary" type="button" className="ghost-button" disabled={recheckingTokens} onClick={() => void recheckTokenList()}>{"重新读取 Token 列表"}</Button></div>}
        {tokensQuery.data && tokens.length > 0 && <div className="paged-panel"><div className="personal-token-list paged-body" ref={pagination.scrollRef} role="table" aria-label="我的 MCP Token">
          <div className="personal-token-head" role="row"><span>Token</span><span>创建时间</span><span>最近使用</span><span>有效期</span><span>状态与操作</span></div>
          {pagination.items.map((token) => {
            const expired = Boolean(token.expiresAt && new Date(token.expiresAt).getTime() <= now);
            const status = token.revokedAt ? "已撤销" : expired ? "已过期" : "有效";
            return <div className="personal-token-row" role="row" key={token.id}>
              <div><KeyRound size={16} /><span><strong>{token.name}</strong><small>pm_{token.prefix}_…</small></span></div>
              <time>{new Date(token.createdAt).toLocaleDateString("zh-CN")}</time>
              <time>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未使用"}</time>
              <time>{token.expiresAt ? new Date(token.expiresAt).toLocaleDateString("zh-CN") : "永久有效"}</time>
              <div><b className={status === "有效" ? "safe-text" : "muted"}>{status}</b>{status === "有效" && <Button variant="secondary" size="small" className="token-revoke-button" disabled={tokenListNeedsRecheck} onClick={() => { if (tokenListNeedsRecheck) return; revoke.reset(); setRevokeTarget(token); }}>撤销</Button>}</div>
            </div>;
          })}
        </div><Pagination {...pagination.props} label="Token 列表分页" /></div>}
        {tokensQuery.data && !tokens.length && <div className="personal-token-empty"><span><KeyRound size={22} /></span><div><strong>还没有个人 Token</strong><p>为 Claude Desktop、Codex 等客户端分别创建 Token，后续可独立撤销。</p></div></div>}
        {tokensQuery.data && tokens.length > 0 && <footer className="personal-token-footer"><span>{activeTokens.length} 个有效 Token</span><small>建议不同客户端使用不同 Token，并定期撤销不再使用的凭据。</small></footer>}
        {tokensQuery.data && !tokens.length && <Pagination {...pagination.props} label="Token 列表分页" />}
      </section>
      {tokenModal && <Modal title="创建 MCP Token" width={560} onClose={closeTokenModal} closable={!createLock.busy}>
        {newToken ? <div className="token-reveal"><ShieldCheck size={38} /><strong>Token 已创建，只显示这一次</strong><p>立即复制并保存到客户端配置中，关闭后无法再次查看。</p><div><code>{newToken}</code><Button variant="secondary" className="ghost-button" onClick={() => void copyText(newToken, "token")}><Copy size={16} />{copied === "token" ? "已复制" : "复制 Token"}</Button></div><Button variant="primary" className="primary-button" onClick={closeTokenModal}>我已安全保存</Button></div>
          : <form className="form-grid" onSubmit={(event) => { event.preventDefault(); if (tokenListNeedsRecheck) return; const data = new FormData(event.currentTarget); createLock.run(() => createToken.mutate({ name: data.get("name"), expiresInDays: data.get("expiresInDays") === "never" ? null : Number(data.get("expiresInDays")) })); }}>
            <div className="token-create-note field-full"><ShieldCheck size={18} /><span>Token 权限与当前账号一致。建议每个客户端单独创建，便于后续识别和撤销。</span></div>
            <FormField label="Token 名称" full><input name="name" required autoFocus disabled={createLock.busy} placeholder="例如：Claude Desktop、办公电脑 Codex" /></FormField>
            <FormField label="有效期" full help="到期后客户端将自动失效，可以随时创建新 Token。"><select name="expiresInDays" defaultValue="90" disabled={createLock.busy}><option value="30">30 天</option><option value="90">90 天（推荐）</option><option value="365">1 年</option><option value="never">永久有效</option></select></FormField>
            <FormError>{createToken.error?.message}</FormError>
            <FormError>{createNeedsRecheck ? "Token 可能已经创建，但密钥无法再次读取。请关闭窗口核对 Token 列表；如出现新 Token，请撤销后重新创建。" : undefined}</FormError>
            {createNeedsRecheck && <div className="field-full"><Button busy={(recheckingTokens)} aria-label={recheckingTokens ? "读取中…" : "重新读取 Token 列表"} variant="secondary" type="button" className="ghost-button" disabled={recheckingTokens} onClick={() => void recheckTokenList()}>{"重新读取 Token 列表"}</Button></div>}
            <FormSubmitActions submitLabel="创建 Token" pendingLabel="创建中…" onCancel={closeTokenModal} pending={createLock.busy} disabled={tokenListNeedsRecheck} />
          </form>}
      </Modal>}
      {revokeTarget && <ConfirmDialog title="撤销 MCP Token" description={<><p>撤销“<strong>{revokeTarget.name}</strong>”后，使用该 Token 的客户端将立即无法访问系统。</p>{revokeNeedsRecheck && <p className="form-error">撤销结果需要核对，请关闭窗口查看最新 Token 列表。</p>}</>} confirmLabel="确认撤销" pendingLabel="撤销中…" danger pending={revoke.isPending} disabled={revokeNeedsRecheck} error={revoke.error?.message} onClose={() => setRevokeTarget(null)} onConfirm={() => revoke.mutate(revokeTarget.id)} />}
    </div>
  </>;
}
