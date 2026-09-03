import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, KeyRound, MoreHorizontal, ShieldCheck, Trash2, UserCog, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { api, jsonBody } from '../api';
import { useApp } from '../app-context';
import type { Account, Person } from '../types';
import { AdaptiveDataCell, AdaptiveDataList, AdaptiveDataRow, type AdaptiveDataColumn } from '../components/AdaptiveDataList';
import { DataCell } from '../components/LayoutPrimitives';
import { ConfirmDialog, EmptyState, Modal, ResultDialog } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { AnchoredPopover, EditableCell, InlineSelectCell, InlineTextCell } from '../components/InlineEdit';
import { accountRoleLabels, accountRoleOptions, accountStatusOptions } from '../ui-options';
import { matchesSearch, searchScore } from '../../shared/search';
import { SearchInput } from '../components/SearchInput';

type OpenAccountResult = { account: Account; temporaryPassword: string };
type IdentityRow = { person: Person; account: Account | null };
type AccessConfirmation =
  | { kind: 'reset'; accountId: string; name: string }
  | { kind: 'delete'; account: Account }
  | { kind: 'toggle'; account: Account; nextStatus: Account['status'] }
  | { kind: 'archive'; person: Person };
type AccessResult = { title: string; message: string; value?: string; error?: boolean };

const accountColumns: AdaptiveDataColumn[] = [
  { key: 'identity', label: '人员与岗位', track: 'minmax(210px,1.25fr)', importance: 'primary', compact: 'primary' },
  { key: 'account', label: '登录账号', track: 'minmax(160px,.85fr)', compact: 'full' },
  { key: 'permission', label: '平台权限', track: 'minmax(210px,1.05fr)', compact: 'full' },
  { key: 'status', label: '登录状态', track: 'minmax(140px,.65fr)', compact: 'detail' },
  { key: 'login', label: '最近登录', track: 'minmax(150px,.7fr)', compact: 'full' },
  { key: 'actions', label: '操作', track: '64px', compact: 'actions', align: 'center' },
];

function AccountPermissionEditor({ account, onSave }: {
  account: Account;
  onSave: (input: { role: Account['globalRole'] }) => Promise<unknown>;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(account.globalRole);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setRole(account.globalRole);
    setError('');
  }, [account.globalRole, open]);
  const submit = async () => {
    setPending(true); setError('');
    try {
      await onSave({ role });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
    } finally { setPending(false); }
  };
  const projectNames = account.managedProjects.map((project) => project.name);
  const fullProjectText = account.globalRole === 'admin' ? '管理全部平台功能'
    : projectNames.length ? `项目经理：${projectNames.join('、')}` : '项目角色在各项目内配置';
  const projectText = account.globalRole === 'admin' || projectNames.length <= 2
    ? fullProjectText
    : `项目经理：${projectNames.slice(0, 2).join('、')} 等 ${projectNames.length} 个项目`;
  const summary = <span className="account-permission-summary" title={fullProjectText}><span className={`account-role role-${account.globalRole}`}><UserCog size={14} />{accountRoleLabels[account.globalRole]}</span><span className="managed-projects">{projectText}</span></span>;
  if (account.isBuiltin) return summary;
  return <div className="inline-edit-anchor" ref={anchorRef}>
    <EditableCell label="平台权限" display={summary} fullText={`${accountRoleLabels[account.globalRole]}，${fullProjectText}`}
      open={open} disabled={false} state={pending ? 'saving' : error ? 'error' : 'idle'} error={error}
      displayMode="stacked" className="account-permission-editor" onOpen={() => setOpen(true)}>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={() => !pending && setOpen(false)} width={390}>
      <div className="inline-action-form account-permission-popover">
        <header><strong>配置平台权限</strong></header>
        <label><span>平台角色</span><select autoFocus value={role} onChange={(event) => setRole(event.target.value as Account['globalRole'])}>{accountRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <p className="inline-action-hint">项目经理在对应项目的“项目设置”中配置；这里仅控制平台管理员权限。</p>
        {error && <p className="form-error">{error}</p>}
        <footer><button type="button" className="ghost-button" onClick={() => setOpen(false)}>取消</button><button type="button" className="primary-button" disabled={pending} onClick={() => void submit()}>保存权限</button></footer>
      </div>
    </AnchoredPopover>
    </EditableCell>
  </div>;
}

function AccountActions({ account, person, currentAccountId, pending, onReset, onToggleLogin, onDelete, onOpen, onArchive }: {
  account: Account | null;
  person: Person | null;
  currentAccountId?: string;
  pending: boolean;
  onReset?: () => void;
  onToggleLogin?: () => void;
  onDelete?: () => void;
  onOpen?: () => void;
  onArchive?: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const name = account?.username || person?.name || '账号';
  return <div className="account-actions" ref={anchorRef}>
    <button type="button" className="account-actions-trigger" aria-label={`打开${name}操作`} aria-expanded={open} disabled={pending} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /></button>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={() => setOpen(false)} width={190} className="account-actions-popover">
      <div role="menu" aria-label={`${name}操作`}>
        {account && onReset && <button type="button" role="menuitem" onClick={() => { setOpen(false); onReset(); }}><KeyRound size={14} />重置密码</button>}
        {account && onToggleLogin && <button type="button" role="menuitem" onClick={() => { setOpen(false); onToggleLogin(); }}>{account.status === 'active' ? <UserRoundX size={14} /> : <UserRoundCheck size={14} />}{account.status === 'active' ? '禁止登录' : '允许登录'}</button>}
        {!account && onOpen && <button type="button" role="menuitem" onClick={() => { setOpen(false); onOpen(); }}><UserRoundCheck size={14} />开通账号</button>}
        {account && !account.isBuiltin && account.id !== currentAccountId && onDelete && <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={14} />删除账号</button>}
        {person && onArchive && <button type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onArchive(); }}><Archive size={14} />归档人员</button>}
      </div>
    </AnchoredPopover>
  </div>;
}

function NewPersonForm({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { name: string; jobTitle: string }) => api<Person>('/api/people', { method: 'POST', body: jsonBody(input) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['people'] });
      void client.invalidateQueries({ queryKey: ['accounts'] });
      onClose();
    },
  });
  return <form className="form-grid" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    mutation.mutate({ name: String(data.get('name') || ''), jobTitle: String(data.get('jobTitle') || '') });
  }}>
    <label className="field field-full"><span>姓名</span><input name="name" required autoFocus /></label>
    <label className="field field-full"><span>岗位</span><input name="jobTitle" placeholder="例如：前端工程师、测试工程师" /></label>
    <p className="field-help field-full">保存后自动创建普通账号，初始密码为 888888。</p>
    {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
    <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={mutation.isPending}>新增人员</button></div>
  </form>;
}

export function PeopleAccessPage() {
  const client = useQueryClient();
  const { session } = useApp();
  const [keyword, setKeyword] = useState('');
  const [jobTitle, setJobTitle] = useState('all');
  const [role, setRole] = useState('all');
  const [loginStatus, setLoginStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<AccessConfirmation | null>(null);
  const [actionError, setActionError] = useState('');
  const [manualPending, setManualPending] = useState(false);
  const [result, setResult] = useState<AccessResult | null>(null);
  const peopleQuery = useQuery({ queryKey: ['people', 'all'], queryFn: () => api<Person[]>('/api/people') });
  const accountsQuery = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/api/accounts') });
  const people = useMemo(() => peopleQuery.data || [], [peopleQuery.data]);
  const accounts = useMemo(() => accountsQuery.data || [], [accountsQuery.data]);
  const builtin = accounts.find((account) => account.isBuiltin) || null;
  const accountByPerson = useMemo(() => new Map(accounts.filter((account) => account.personId).map((account) => [account.personId!, account])), [accounts]);
  const rows = useMemo<IdentityRow[]>(() => people.map((person) => ({ person, account: accountByPerson.get(person.id) || null })), [accountByPerson, people]);
  const jobTitles = useMemo(() => [...new Set(people.map((person) => person.jobTitle).filter(Boolean) as string[])].sort((left, right) => left.localeCompare(right, 'zh-CN')), [people]);
  const filteredRows = useMemo(() => {
    return rows.filter(({ person, account }) => {
      const effectiveLoginStatus = account?.status || 'missing';
      return matchesSearch([
        { text: person.name, weight: 100 },
        { text: account?.username, weight: 50 },
        { text: person.jobTitle, weight: 20 },
      ], keyword)
        && (jobTitle === 'all' || person.jobTitle === jobTitle)
        && (role === 'all' || account?.globalRole === role)
        && (loginStatus === 'all' || effectiveLoginStatus === loginStatus);
    }).sort((left, right) => keyword.trim()
      ? searchScore([{ text: right.person.name, weight: 100 }, { text: right.account?.username, weight: 50 }, right.person.jobTitle], keyword)
        - searchScore([{ text: left.person.name, weight: 100 }, { text: left.account?.username, weight: 50 }, left.person.jobTitle], keyword)
      : 0);
  }, [jobTitle, keyword, loginStatus, role, rows]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['accounts'] });
    void client.invalidateQueries({ queryKey: ['people'] });
    void client.invalidateQueries({ queryKey: ['project-members'] });
    void client.invalidateQueries({ queryKey: ['projects'] });
    void client.invalidateQueries({ queryKey: ['session'] });
  };
  const reset = useMutation({
    mutationFn: (id: string) => api<{ temporaryPassword: string }>(`/api/accounts/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (response) => {
      refresh();
      setConfirmation(null);
      setResult({ title: '密码已重置', message: '该用户下次登录时必须修改初始密码。', value: response.temporaryPassword });
    },
  });
  const removeAccount = useMutation({
    mutationFn: (id: string) => api<{ ok: true }>(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); setConfirmation(null); },
  });
  const openAccount = useMutation({
    mutationFn: (personId: string) => api<OpenAccountResult>(`/api/people/${personId}/account`, { method: 'POST' }),
    onSuccess: (response) => {
      refresh();
      setResult({ title: '账号已开通', message: `账号“${response.account.username}”已经可以登录，下次登录时必须修改初始密码。`, value: response.temporaryPassword });
    },
    onError: (error) => setResult({ title: '开通账号失败', message: error instanceof Error ? error.message : '开通账号失败', error: true }),
  });
  const archivePerson = useMutation({
    mutationFn: (personId: string) => api(`/api/people/${personId}`, { method: 'DELETE' }),
    onSuccess: () => { setConfirmation(null); refresh(); void client.invalidateQueries({ queryKey: ['archives'] }); },
  });
  const saveAccount = async (account: Account, input: Record<string, unknown>) => {
    const previous = client.getQueryData<Account[]>(['accounts']);
    client.setQueryData<Account[]>(['accounts'], (current = []) => current.map((entry) => {
      if (entry.id !== account.id) return entry;
      const nextGlobalRole = input.role === 'admin' || input.role === 'user' ? input.role : entry.globalRole;
      return {
        ...entry,
        ...(typeof input.username === 'string' ? { username: input.username } : {}),
        ...(input.status === 'active' || input.status === 'disabled' ? { status: input.status } : {}),
        globalRole: nextGlobalRole,
        role: nextGlobalRole === 'admin' ? 'admin' : entry.managedProjects.length ? 'project_manager' : 'user',
      };
    }));
    try {
      const saved = await api<Account>(`/api/accounts/${account.id}`, { method: 'PATCH', body: jsonBody(input) });
      client.setQueryData<Account[]>(['accounts'], (current = []) => current.map((entry) => entry.id === saved.id ? saved : entry));
      refresh();
    } catch (error) {
      client.setQueryData(['accounts'], previous);
      throw error;
    }
  };
  const savePerson = async (person: Person, input: Record<string, unknown>) => {
    const previous = client.getQueryData<Person[]>(['people', 'all']);
    client.setQueryData<Person[]>(['people', 'all'], (current = []) => current.map((entry) => entry.id === person.id ? { ...entry, ...input } : entry));
    try {
      const saved = await api<Person>(`/api/people/${person.id}`, { method: 'PATCH', body: jsonBody(input) });
      client.setQueryData<Person[]>(['people', 'all'], (current = []) => current.map((entry) => entry.id === saved.id ? { ...entry, ...saved } : entry));
      void client.invalidateQueries({ queryKey: ['accounts'] });
      void client.invalidateQueries({ queryKey: ['people'] });
    } catch (error) {
      client.setQueryData(['people', 'all'], previous);
      throw error;
    }
  };
  const openConfirmation = (target: AccessConfirmation) => {
    reset.reset();
    removeAccount.reset();
    archivePerson.reset();
    setActionError('');
    setConfirmation(target);
  };
  const runConfirmedAction = async () => {
    if (!confirmation) return;
    if (confirmation.kind === 'reset') { reset.mutate(confirmation.accountId); return; }
    if (confirmation.kind === 'delete') { removeAccount.mutate(confirmation.account.id); return; }
    if (confirmation.kind === 'archive') { archivePerson.mutate(confirmation.person.id); return; }
    setManualPending(true); setActionError('');
    try {
      await saveAccount(confirmation.account, { status: confirmation.nextStatus });
      setConfirmation(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '更新登录状态失败');
    } finally { setManualPending(false); }
  };
  const confirmationError = actionError || (confirmation?.kind === 'reset' ? reset.error?.message
    : confirmation?.kind === 'delete' ? removeAccount.error?.message
      : confirmation?.kind === 'archive' ? archivePerson.error?.message : undefined);
  const pending = reset.isPending || removeAccount.isPending || openAccount.isPending || archivePerson.isPending || manualPending;

  return <>
    <PageHeader title="人员与权限" actions={<button className="primary-button" onClick={() => setCreating(true)}><UserPlus size={16} />新增人员</button>} />
    <div className="page-content accounts-page people-access-page">
      {builtin && <section className="system-account-card">
        <span className="system-account-icon"><ShieldCheck size={21} /></span>
        <div className="system-account-copy"><strong>系统管理员账号</strong><span>{builtin.username} · 不关联业务人员</span></div>
        <AccountPermissionEditor account={builtin} onSave={async () => undefined} />
        <span className={`account-status ${builtin.status}`}>允许登录</span>
        <span className="system-account-login">{builtin.lastLoginAt ? `最近登录 ${new Date(builtin.lastLoginAt).toLocaleString('zh-CN')}` : '从未登录'}</span>
        <AccountActions account={builtin} person={null} currentAccountId={session.accountId} pending={pending} onReset={() => openConfirmation({ kind: 'reset', accountId: builtin.id, name: builtin.username })} />
      </section>}
      <div className="filter-bar people-access-filters">
        <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索姓名、岗位、登录名或拼音" />
        <select aria-label="按岗位筛选" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)}><option value="all">全部岗位</option>{jobTitles.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="按平台权限筛选" value={role} onChange={(event) => setRole(event.target.value)}><option value="all">全部平台权限</option>{accountRoleOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        <select aria-label="按登录状态筛选" value={loginStatus} onChange={(event) => setLoginStatus(event.target.value)}><option value="all">全部登录状态</option><option value="active">允许登录</option><option value="disabled">禁止登录</option><option value="missing">未开通账号</option></select>
        <span>{filteredRows.length} 名人员</span>
      </div>
      {filteredRows.length ? <AdaptiveDataList label="人员与权限列表" className="account-data-list people-access-list" columns={accountColumns}>
        {filteredRows.map(({ person, account }) => <AdaptiveDataRow className="account-data-row people-access-row" key={person.id}>
          <AdaptiveDataCell column="identity" className="account-data-primary"><div className="people-access-person-editor"><InlineTextCell value={person.name} label="人员姓名" required onSave={(name) => savePerson(person, { name })} /><InlineTextCell value={person.jobTitle} label="岗位" placeholder="岗位未设置" onSave={(value) => savePerson(person, { jobTitle: value || null })} renderValue={(value) => <small>{value}</small>} /></div></AdaptiveDataCell>
          <AdaptiveDataCell column="account" className="account-data-account"><DataCell primary={account ? <InlineTextCell value={account.username} label="登录名" required onSave={(username) => saveAccount(account, { username })} /> : <span className="account-missing"><UserRoundCheck size={15} />未开通账号</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="permission" className="account-data-permission"><DataCell primary={account ? <AccountPermissionEditor account={account} onSave={(input) => saveAccount(account, input)} /> : <span className="account-muted">开通账号后配置</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="status" className="account-data-status"><DataCell primary={account ? <InlineSelectCell value={account.status} label="登录状态" options={accountStatusOptions} displayMode="badge" onSave={async (status) => {
            const total = account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues;
            if (status === 'disabled' && total > 0) { openConfirmation({ kind: 'toggle', account, nextStatus: status }); return; }
            await saveAccount(account, { status });
          }} renderValue={(value, option) => <span className={`account-status ${value}`}>{option?.label || value}</span>} /> : <span className="account-status missing">未开通</span>}
            secondary={account?.mustChangePassword || account?.status === 'disabled' && account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues > 0 ? <>{account?.mustChangePassword && <span className="account-password-state">待修改初始密码</span>}{account?.status === 'disabled' && account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues > 0 && <span className="account-assignment-warning">仍有待处理任务</span>}</> : undefined} /></AdaptiveDataCell>
          <AdaptiveDataCell column="login" className="account-data-login"><DataCell primary={account ? account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('zh-CN') : '从未登录' : '—'} /></AdaptiveDataCell>
          <AdaptiveDataCell column="actions" className="account-data-actions"><AccountActions account={account} person={person} currentAccountId={session.accountId} pending={pending}
            onReset={account ? () => openConfirmation({ kind: 'reset', accountId: account.id, name: account.username }) : undefined}
            onToggleLogin={account ? () => {
              const nextStatus = account.status === 'active' ? 'disabled' : 'active';
              if (nextStatus === 'disabled') { openConfirmation({ kind: 'toggle', account, nextStatus }); return; }
              void saveAccount(account, { status: nextStatus }).catch((error) => setResult({ title: '更新登录状态失败', message: error instanceof Error ? error.message : '更新登录状态失败', error: true }));
            } : undefined}
            onDelete={account ? () => openConfirmation({ kind: 'delete', account }) : undefined}
            onOpen={!account ? () => openAccount.mutate(person.id) : undefined}
            onArchive={() => openConfirmation({ kind: 'archive', person })} /></AdaptiveDataCell>
        </AdaptiveDataRow>)}
      </AdaptiveDataList> : !peopleQuery.isLoading && !accountsQuery.isLoading && <EmptyState title="没有符合条件的人员" detail={rows.length ? '请调整搜索或筛选条件。' : '新增人员后会自动创建登录账号。'} />}
      {(peopleQuery.error || accountsQuery.error) && <p className="form-error">{(peopleQuery.error || accountsQuery.error)?.message}</p>}
    </div>
    {creating && <Modal title="新增人员" width={520} onClose={() => setCreating(false)}><NewPersonForm onClose={() => setCreating(false)} /></Modal>}
    {confirmation && <ConfirmDialog
      title={{ reset: '重置账号密码', delete: '删除登录账号', toggle: '禁止账号登录', archive: '归档人员' }[confirmation.kind]}
      description={confirmation.kind === 'reset'
        ? <>将“<strong>{confirmation.name}</strong>”的密码重置为系统初始密码？该用户下次登录时必须修改密码。</>
        : confirmation.kind === 'delete'
          ? <>删除账号“<strong>{confirmation.account.username}</strong>”后将立即停止登录并撤销其 Token，但人员、项目角色和历史记录会保留。{confirmation.account.activeAssignments.requirements + confirmation.account.activeAssignments.workItems + confirmation.account.activeAssignments.issues > 0 && <p>当前仍关联需求 {confirmation.account.activeAssignments.requirements} 项、工作项 {confirmation.account.activeAssignments.workItems} 项、问题 {confirmation.account.activeAssignments.issues} 项。</p>}</>
          : confirmation.kind === 'toggle'
            ? <>禁止“<strong>{confirmation.account.username}</strong>”登录不会重新分配其任务。当前关联需求 {confirmation.account.activeAssignments.requirements} 项、工作项 {confirmation.account.activeAssignments.workItems} 项、问题 {confirmation.account.activeAssignments.issues} 项。</>
            : <>归档人员“<strong>{confirmation.person.name}</strong>”？如仍有未完成任务，系统会阻止归档并提示需要重新分配的内容。</>}
      confirmLabel={{ reset: '确认重置', delete: '删除账号', toggle: '禁止登录', archive: '确认归档' }[confirmation.kind]}
      pendingLabel="处理中…"
      danger={confirmation.kind !== 'reset'}
      pending={pending}
      error={confirmationError}
      onClose={() => { if (!pending) { setConfirmation(null); setActionError(''); } }}
      onConfirm={() => void runConfirmedAction()}
    />}
    {result && <ResultDialog title={result.title} message={result.message} value={result.value} error={result.error} onClose={() => setResult(null)} />}
  </>;
}

export const AccountsPage = PeopleAccessPage;
