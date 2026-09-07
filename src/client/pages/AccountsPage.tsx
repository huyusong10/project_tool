import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, KeyRound, MoreHorizontal, Trash2, UserCog, UserPlus, UserRoundCheck, UserRoundX } from 'lucide-react';
import { api, isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from '../api';
import { useSession } from '../app-context';
import { invalidateArchiveViews, invalidateAccountPermissionViews, invalidateAccountViews, keys } from '../query-keys';
import { useOptimisticMutation } from '../use-optimistic-mutation';
import type { Account, Archives, Person } from '../types';
import { AdaptiveDataCell, AdaptiveDataList, AdaptiveDataRow, type AdaptiveDataColumn } from '../components/AdaptiveDataList';
import { DataCell } from '../components/LayoutPrimitives';
import { ConfirmDialog, Modal, ResultDialog, useSynchronousPendingLock } from '../components/Modal';
import { EmptyState, LoadingState } from '../components/Feedback';
import { PageHeader } from '../components/PageHeader';
import { AnchoredPopover, EditableCell, InlineSelectCell, InlineTextCell } from '../components/InlineEdit';
import { accountRoleLabels, accountRoleOptions, accountStatusOptions } from '../ui-options';
import { canonicalizeLabel, matchesSearch, searchScore } from '../../shared/search';
import { SearchInput } from '../components/SearchInput';
import { StatusBadge } from '../components/Badge';
import { FormError, FormField, FormSubmitActions } from '../components/Form';
import { useToast } from '../components/Toast';

type OpenAccountResult = { account: Account; temporaryPassword: string };
type IdentityRow = { person: Person; account: Account | null };
type AccessConfirmation =
  | { kind: 'reset'; account: Account }
  | { kind: 'delete'; account: Account }
  | { kind: 'toggle'; account: Account; nextStatus: Account['status'] }
  | { kind: 'archive'; person: Person; account: Account | null };
type AccessResult = { title: string; message: string; value?: string; error?: boolean };

const emptyPeople: Person[] = [];
const emptyAccounts: Account[] = [];

const errorMessage = (error: unknown) => error instanceof Error ? error.message : undefined;

function assignmentKey(account: Account) {
  const { requirements, workItems, issues } = account.activeAssignments;
  return `${requirements}:${workItems}:${issues}`;
}

function personAccessKey(account: Account | null | undefined) {
  if (!account) return 'none';
  return JSON.stringify([
    account.id,
    account.updatedAt,
    assignmentKey(account),
    account.managedProjects.map(({ id }) => id).sort(),
  ]);
}

const accountColumns: AdaptiveDataColumn[] = [
  { key: 'identity', label: '人员与岗位', track: 'minmax(210px,1.25fr)', importance: 'primary', compact: 'primary' },
  { key: 'account', label: '登录账号', track: 'minmax(160px,.85fr)', compact: 'full' },
  { key: 'permission', label: '平台权限', track: 'minmax(210px,1.05fr)', compact: 'full' },
  { key: 'status', label: '登录状态', track: 'minmax(140px,.65fr)', compact: 'detail' },
  { key: 'login', label: '最近登录', track: 'minmax(150px,.7fr)', compact: 'full' },
  { key: 'actions', label: '操作', track: '64px', compact: 'actions', align: 'center' },
];

function AccountPermissionEditor({ account, disabled = false, onSave, onReload }: {
  account: Account;
  disabled?: boolean;
  onSave: (input: { role: Account['globalRole'] }, expectedUpdatedAt: string) => Promise<unknown>;
  onReload: () => Promise<Account>;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(account.globalRole);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState(account.updatedAt);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const changed = account.updatedAt !== baselineUpdatedAt;
  const submit = async () => {
    if (submitting.current || reading || changed || needsRefresh) return;
    submitting.current = true;
    setPending(true); setError('');
    try {
      await onSave({ role }, baselineUpdatedAt);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
      if (requiresWriteRecheck(caught)) setNeedsRefresh(true);
    } finally { submitting.current = false; setPending(false); }
  };
  const reload = async () => {
    if (reading || submitting.current) return;
    setReading(true); setError('');
    try {
      const latest = await onReload();
      setBaselineUpdatedAt(latest.updatedAt);
      setRole(latest.globalRole);
      setNeedsRefresh(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '账号读取失败');
    } finally { setReading(false); }
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
      open={open} disabled={disabled} state={pending || reading ? 'saving' : error ? 'error' : 'idle'} error={error}
      displayMode="stacked" className="account-permission-editor" onOpen={() => { setRole(account.globalRole); setBaselineUpdatedAt(account.updatedAt); setNeedsRefresh(false); setError(''); setOpen(true); }}>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={() => !submitting.current && !reading && setOpen(false)} width={390}>
      <div className="inline-action-form account-permission-popover">
        <header><strong>配置平台权限</strong></header>
        <label><span>平台角色</span><select autoFocus disabled={pending || reading || disabled} value={role} onChange={(event) => setRole(event.target.value as Account['globalRole'])}>{accountRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <p className="inline-action-hint">项目经理在对应项目的“项目设置”中配置；这里仅控制平台管理员权限。</p>
        {(changed || needsRefresh) && <div className="warning-banner">账号权限已更新，当前选择尚未提交。<button type="button" className="ghost-button" disabled={reading || pending} onClick={() => void reload()}>{reading ? '读取中…' : '重新读取账号'}</button></div>}
        {error && <p className="form-error">{error}</p>}
        <footer><button type="button" className="ghost-button" disabled={pending || reading || disabled} onClick={() => setOpen(false)}>取消</button><button type="button" className="primary-button" disabled={pending || reading || disabled || changed || needsRefresh} onClick={() => void submit()}>{pending ? '保存中…' : '保存权限'}</button></footer>
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
  const toast = useToast();
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const initialPersonIds = useRef<Set<string> | null | undefined>(undefined);
  if (initialPersonIds.current === undefined) {
    const queryKey = [...keys.people, 'all'];
    const cached = client.getQueryData<Person[]>(queryKey);
    initialPersonIds.current = client.getQueryState(queryKey)?.status === 'success' && cached
      ? new Set(cached.map((person) => person.id))
      : null;
  }
  const mutation = useMutation({
    mutationFn: (input: { name: string; jobTitle: string }) => api<Person>('/api/people', { method: 'POST', body: jsonBody(input) }),
    onSuccess: () => {
      invalidateAccountViews(client);
      onClose();
    },
    onError: async (error, input) => {
      const sourceIds = initialPersonIds.current;
      if (!sourceIds || !requiresWriteRecheck(error)) return;
      try {
        const latest = await api<Person[]>('/api/people', { readOnly: true });
        const matches = latest.filter((person) => !sourceIds.has(person.id)
          && person.name === canonicalizeLabel(input.name)
          && person.jobTitle === (canonicalizeLabel(input.jobTitle) || null)
          && Boolean(person.active));
        if (matches.length === 1 && mounted.current) {
          invalidateAccountViews(client);
          toast.success('已核对最新状态：人员和账号已创建');
          onClose();
        }
      } catch {
        // 保留原写入错误和草稿，避免把读取失败误判为创建成功。
      }
    },
  });
  const lock = useSynchronousPendingLock(mutation.isPending);
  const close = () => {
    if (lock.canClose()) onClose();
  };
  return <Modal title="新增人员" width={520} closable={!lock.busy} onClose={close}><form className="form-grid" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    lock.run(() => mutation.mutate({ name: String(data.get('name') || ''), jobTitle: String(data.get('jobTitle') || '') }));
  }}>
    <FormField label="姓名" full><input name="name" required autoFocus disabled={lock.busy} /></FormField>
    <FormField label="岗位" full><input name="jobTitle" disabled={lock.busy} placeholder="例如：前端工程师、测试工程师" /></FormField>
    <p className="field-help field-full">保存后自动创建普通账号，初始密码为 888888。</p>
    <FormError>{mutation.error?.message}</FormError>
    <FormSubmitActions submitLabel="新增人员" onCancel={close} pending={lock.busy} />
  </form></Modal>;
}

export function PeopleAccessPage() {
  const client = useQueryClient();
  const { session } = useSession();
  const [keyword, setKeyword] = useState('');
  const [jobTitle, setJobTitle] = useState('all');
  const [role, setRole] = useState('all');
  const [loginStatus, setLoginStatus] = useState('all');
  const [creating, setCreating] = useState(false);
  const [confirmation, setConfirmation] = useState<AccessConfirmation | null>(null);
  const [confirmationNeedsReopen, setConfirmationNeedsReopen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [manualPending, setManualPending] = useState(false);
  const [result, setResult] = useState<AccessResult | null>(null);
  const confirmationSubmitting = useRef(false);
  const accountSavingRef = useRef(new Set<string>());
  const [savingAccountIds, setSavingAccountIds] = useState<Set<string>>(() => new Set());
  const personSavingRef = useRef(new Set<string>());
  const [savingPersonIds, setSavingPersonIds] = useState<Set<string>>(() => new Set());
  const peopleQuery = useQuery({ queryKey: [...keys.people, 'all'], queryFn: ({ signal }) => api<Person[]>('/api/people', { signal }) });
  const accountsQuery = useQuery({ queryKey: keys.accounts, queryFn: ({ signal }) => api<Account[]>('/api/accounts', { signal }) });
  const people = peopleQuery.data || emptyPeople;
  const accounts = accountsQuery.data || emptyAccounts;
  const dataReady = peopleQuery.data !== undefined && accountsQuery.data !== undefined;
  const loadError = peopleQuery.error || accountsQuery.error;
  const retry = () => void Promise.all([peopleQuery.refetch(), accountsQuery.refetch()]);
  const reloadAccount = async (id: string) => {
    const result = await accountsQuery.refetch({ throwOnError: true });
    const latest = result.data?.find((account) => account.id === id);
    if (!latest) throw new Error('账号已不存在，请关闭编辑器。');
    return latest;
  };
  const reloadPerson = async (id: string) => {
    const result = await peopleQuery.refetch({ throwOnError: true });
    const latest = result.data?.find((person) => person.id === id);
    if (!latest) throw new Error('人员已不存在，请关闭编辑器。');
    return latest;
  };
  const accountByPerson = useMemo(() => new Map(accounts.filter((account) => account.personId).map((account) => [account.personId!, account])), [accounts]);
  const rows = useMemo<IdentityRow[]>(() => people.map((person) => ({ person, account: accountByPerson.get(person.id) || null })), [accountByPerson, people]);
  const confirmationInvalidReason = useMemo(() => {
    if (!confirmation) return '';
    if (confirmationNeedsReopen) return '账号或人员状态已变化，请关闭窗口后从最新列表重新选择操作。';
    if (confirmation.kind === 'archive') {
      const currentPerson = people.find((person) => person.id === confirmation.person.id);
      if (!currentPerson) return '人员已不在当前列表，请关闭窗口后刷新确认。';
      if (currentPerson.updatedAt !== confirmation.person.updatedAt) return '人员资料已更新，请关闭窗口后重新选择归档。';
      if (personAccessKey(accountByPerson.get(currentPerson.id)) !== personAccessKey(confirmation.account)) {
        return '人员的账号、在办任务或项目角色已变化，请关闭窗口后重新选择归档。';
      }
      return '';
    }
    const currentAccount = accounts.find((account) => account.id === confirmation.account.id);
    if (!currentAccount) return '账号已不在当前列表，请关闭窗口后刷新确认。';
    if (currentAccount.updatedAt !== confirmation.account.updatedAt) return '账号已更新，请关闭窗口后重新选择操作。';
    if (confirmation.kind !== 'reset' && assignmentKey(currentAccount) !== assignmentKey(confirmation.account)) {
      return '账号关联的在办任务已变化，请关闭窗口后重新选择操作。';
    }
    return '';
  }, [accountByPerson, accounts, confirmation, confirmationNeedsReopen, people]);
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
    invalidateAccountPermissionViews(client);
  };
  const lockConfirmationAfterError = (caught: unknown) => {
    if (!requiresWriteRecheck(caught)) return;
    setConfirmationNeedsReopen(true);
    refresh();
  };
  const reset = useMutation({
    mutationFn: (account: Account) => api<{ temporaryPassword: string }>(`/api/accounts/${account.id}/reset-password`, { method: 'POST', body: jsonBody({ expectedUpdatedAt: account.updatedAt }) }),
    onSuccess: (response) => {
      refresh();
      setConfirmation(null);
      setResult({ title: '密码已重置', message: '该用户下次登录时必须修改初始密码。', value: response.temporaryPassword });
    },
    onError: async (error, account) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latestAccounts = await api<Account[]>('/api/accounts', { readOnly: true });
          const latest = latestAccounts.find((entry) => entry.id === account.id);
          client.setQueryData(keys.accounts, latestAccounts);
          refresh();
          if (latest && latest.updatedAt !== account.updatedAt && latest.mustChangePassword) {
            setConfirmation(null);
            setResult({
              title: '密码已重置',
              message: '已核对最新状态：该用户下次登录时必须修改初始密码。',
              value: '888888',
            });
            return;
          }
        } catch {
          // 保留原始写入异常；读回失败不能据此判定写入成功或失败。
        }
      }
      lockConfirmationAfterError(error);
    },
    onSettled: () => { confirmationSubmitting.current = false; },
  });
  const removeAccount = useMutation({
    mutationFn: (account: Account) => api<{ ok: true }>(`/api/accounts/${account.id}`, { method: 'DELETE', body: jsonBody({ expectedUpdatedAt: account.updatedAt }) }),
    onSuccess: () => { refresh(); setConfirmation(null); },
    onError: async (error, account) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latestAccounts = await api<Account[]>('/api/accounts', { readOnly: true });
          client.setQueryData(keys.accounts, latestAccounts);
          refresh();
          if (!latestAccounts.some((entry) => entry.id === account.id)) {
            setConfirmation(null);
            return;
          }
        } catch {
          // 保留原始写入异常；读回失败不能据此判定写入成功或失败。
        }
      }
      lockConfirmationAfterError(error);
    },
    onSettled: () => { confirmationSubmitting.current = false; },
  });
  const openAccount = useMutation({
    mutationFn: (person: Person) => api<OpenAccountResult>(`/api/people/${person.id}/account`, {
      method: 'POST', body: jsonBody({ expectedAccountDeletedAt: person.accountDeletedAt || null }),
    }),
    onSuccess: (response) => {
      refresh();
      setResult({ title: '账号已开通', message: `账号“${response.account.username}”已经可以登录，下次登录时必须修改初始密码。`, value: response.temporaryPassword });
    },
    onError: async (error, person) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latestAccounts = await api<Account[]>('/api/accounts', { readOnly: true });
          const opened = latestAccounts.find((account) => account.personId === person.id
            && account.status === 'active'
            && account.mustChangePassword);
          client.setQueryData(keys.accounts, latestAccounts);
          refresh();
          if (opened) {
            setResult({
              title: '账号已开通',
              message: `已核对最新状态：账号“${opened.username}”已经可以登录，下次登录时必须修改初始密码。`,
              value: '888888',
            });
            return;
          }
        } catch {
          // 保留原始写入异常；读回失败不能据此判定写入成功或失败。
        }
      }
      if (requiresWriteRecheck(error)) refresh();
      setResult({ title: '开通账号失败', message: error instanceof Error ? error.message : '开通账号失败', error: true });
    },
  });
  const openAccountLock = useSynchronousPendingLock(openAccount.isPending);
  const archivePerson = useMutation({
    mutationFn: (person: Person) => api(`/api/people/${person.id}`, { method: 'DELETE', body: jsonBody({ expectedUpdatedAt: person.updatedAt }) }),
    onSuccess: () => { setConfirmation(null); invalidateArchiveViews(client); },
    onError: async (error, person) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const [latestPeople, latestArchives] = await Promise.all([
            api<Person[]>('/api/people', { readOnly: true }),
            api<Archives>('/api/archives', { readOnly: true }),
          ]);
          client.setQueryData([...keys.people, 'all'], latestPeople);
          client.setQueryData(keys.archives, latestArchives);
          if (!latestPeople.some((entry) => entry.id === person.id)
            && latestArchives.people.some((entry) => entry.id === person.id)) {
            setConfirmation(null);
            invalidateArchiveViews(client);
            return;
          }
        } catch {
          // 保留原始写入异常；活动列表与归档列表必须同时读回才能确认归档成功。
        }
      }
      lockConfirmationAfterError(error);
    },
    onSettled: () => { confirmationSubmitting.current = false; },
  });
  const runAccountSave = useOptimisticMutation<{ account: Account; input: Record<string, unknown> }, Account>({
    snapshotKeys: [keys.accounts],
    apply: (queryClient, { account, input }) => {
      // 权限筛选会卸载角色变化的账号行；等待服务端确认后再更新角色。
      if (input.role !== undefined) return;
      queryClient.setQueryData<Account[]>(keys.accounts, (current = []) => current.map((entry) => {
        if (entry.id !== account.id) return entry;
        return {
          ...entry,
          ...(typeof input.username === 'string' ? { username: input.username } : {}),
          ...(input.status === 'active' || input.status === 'disabled' ? { status: input.status } : {}),
        };
      }));
    },
    request: ({ account, input }) => api<Account>(`/api/accounts/${account.id}`, { method: 'PATCH', body: jsonBody(input) }),
    commit: (queryClient, saved) => {
      queryClient.setQueryData<Account[]>(keys.accounts, (current = []) => current.map((entry) => entry.id === saved.id ? saved : entry));
      invalidateAccountPermissionViews(queryClient);
    },
  });
  const saveAccount = async (account: Account, input: Record<string, unknown>, expectedUpdatedAt = account.updatedAt) => {
    if (account.personId && personSavingRef.current.has(account.personId)) throw new Error('该人员资料正在保存，请稍后再试');
    if (accountSavingRef.current.has(account.id)) throw new Error('该账号正在保存，请稍后再试');
    accountSavingRef.current.add(account.id);
    setSavingAccountIds((current) => new Set(current).add(account.id));
    try {
      try {
        return await runAccountSave({ account, input: { ...input, expectedUpdatedAt } });
      } catch (error) {
        const desiredStatus = input.status;
        const desiredUsername = typeof input.username === 'string' ? canonicalizeLabel(input.username) : undefined;
        const desiredRole = input.role === 'user' || input.role === 'admin' ? input.role : undefined;
        const knownFieldsOnly = Object.keys(input).length > 0
          && Object.keys(input).every((key) => key === 'status' || key === 'username' || key === 'role');
        if (isWriteOutcomeUnknown(error) && knownFieldsOnly) {
          try {
            const latestAccounts = await api<Account[]>('/api/accounts', { readOnly: true });
            const latest = latestAccounts.find((entry) => entry.id === account.id);
            client.setQueryData(keys.accounts, latestAccounts);
            refresh();
            if (latest && latest.updatedAt !== expectedUpdatedAt
              && (desiredStatus === undefined || latest.status === desiredStatus)
              && (desiredUsername === undefined || latest.username === desiredUsername)
              && (desiredRole === undefined || latest.globalRole === desiredRole)) return latest;
          } catch {
            // 保留原始写入异常；读回失败不能据此判定账号字段写入成功。
          }
        }
        throw error;
      }
    } finally {
      accountSavingRef.current.delete(account.id);
      setSavingAccountIds((current) => {
        const next = new Set(current);
        next.delete(account.id);
        return next;
      });
    }
  };
  const runPersonSave = useOptimisticMutation<{ person: Person; input: Record<string, unknown> }, Person>({
    snapshotKeys: [[...keys.people, 'all']],
    apply: (queryClient, { person, input }) => {
      queryClient.setQueryData<Person[]>([...keys.people, 'all'], (current = []) => current.map((entry) => entry.id === person.id ? { ...entry, ...input } : entry));
    },
    request: ({ person, input }) => api<Person>(`/api/people/${person.id}`, { method: 'PATCH', body: jsonBody(input) }),
    commit: (queryClient, saved) => {
      queryClient.setQueryData<Person[]>([...keys.people, 'all'], (current = []) => current.map((entry) => entry.id === saved.id ? { ...entry, ...saved } : entry));
      invalidateAccountViews(queryClient);
    },
  });
  const savePerson = async (person: Person, input: Record<string, unknown>, expectedUpdatedAt = person.updatedAt) => {
    const account = accountByPerson.get(person.id);
    if (personSavingRef.current.has(person.id) || account && accountSavingRef.current.has(account.id)) throw new Error('该人员正在保存，请稍后再试');
    personSavingRef.current.add(person.id);
    setSavingPersonIds((current) => new Set(current).add(person.id));
    try {
      try {
        return await runPersonSave({ person, input: { ...input, expectedUpdatedAt } });
      } catch (error) {
        const hasName = typeof input.name === 'string';
        const hasJobTitle = Object.prototype.hasOwnProperty.call(input, 'jobTitle');
        const desiredName = hasName ? canonicalizeLabel(input.name) : undefined;
        const desiredJobTitle = hasJobTitle ? canonicalizeLabel(input.jobTitle) || null : undefined;
        const knownFieldsOnly = Object.keys(input).length > 0
          && Object.keys(input).every((key) => key === 'name' || key === 'jobTitle');
        if (isWriteOutcomeUnknown(error) && knownFieldsOnly) {
          try {
            const latestPeople = await api<Person[]>('/api/people', { readOnly: true });
            const latest = latestPeople.find((entry) => entry.id === person.id);
            client.setQueryData([...keys.people, 'all'], latestPeople);
            invalidateAccountViews(client);
            if (latest && latest.updatedAt !== expectedUpdatedAt
              && (desiredName === undefined || latest.name === desiredName)
              && (!hasJobTitle || latest.jobTitle === desiredJobTitle)) return latest;
          } catch {
            // 保留原始写入异常；读回失败不能据此判定人员字段写入成功。
          }
        }
        throw error;
      }
    } finally {
      personSavingRef.current.delete(person.id);
      setSavingPersonIds((current) => {
        const next = new Set(current);
        next.delete(person.id);
        return next;
      });
    }
  };
  const openConfirmation = (target: AccessConfirmation) => {
    reset.reset();
    removeAccount.reset();
    archivePerson.reset();
    setActionError('');
    setConfirmationNeedsReopen(false);
    setConfirmation(target);
  };
  const runConfirmedAction = async () => {
    if (!confirmation || confirmationSubmitting.current || confirmationInvalidReason) return;
    confirmationSubmitting.current = true;
    if (confirmation.kind === 'reset') { reset.mutate(confirmation.account); return; }
    if (confirmation.kind === 'delete') { removeAccount.mutate(confirmation.account); return; }
    if (confirmation.kind === 'archive') { archivePerson.mutate(confirmation.person); return; }
    setManualPending(true); setActionError('');
    try {
      await saveAccount(confirmation.account, { status: confirmation.nextStatus });
      setConfirmation(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '更新登录状态失败');
      lockConfirmationAfterError(error);
    } finally { confirmationSubmitting.current = false; setManualPending(false); }
  };
  const confirmationError = confirmationInvalidReason || actionError || (confirmation?.kind === 'reset' ? errorMessage(reset.error)
    : confirmation?.kind === 'delete' ? errorMessage(removeAccount.error)
      : confirmation?.kind === 'archive' ? errorMessage(archivePerson.error) : undefined);
  const pending = reset.isPending || removeAccount.isPending || openAccountLock.busy || archivePerson.isPending || manualPending;

  return <>
    <PageHeader title="人员与权限" actions={<button className="primary-button" onClick={() => setCreating(true)}><UserPlus size={16} />新增人员</button>} />
    <div className="page-content accounts-page people-access-page">
      {!dataReady && loadError ? <EmptyState title="人员与权限加载失败" detail={loadError.message || '暂时无法读取人员与账号，请稍后重试。'} action={<button className="ghost-button" disabled={peopleQuery.isFetching || accountsQuery.isFetching} onClick={retry}>重新加载</button>} />
        : !dataReady ? <LoadingState label="正在加载人员与权限…" className="stable-panel-state" /> : <>
      {loadError && <div className="warning-banner">数据刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={peopleQuery.isFetching || accountsQuery.isFetching} onClick={retry}>重新加载</button></div>}
      <div className="filter-bar people-access-filters">
        <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索姓名、岗位、登录名或拼音" />
        <select aria-label="按岗位筛选" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)}><option value="all">全部岗位</option>{jobTitles.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="按平台权限筛选" value={role} onChange={(event) => setRole(event.target.value)}><option value="all">全部平台权限</option>{accountRoleOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        <select aria-label="按登录状态筛选" value={loginStatus} onChange={(event) => setLoginStatus(event.target.value)}><option value="all">全部登录状态</option><option value="active">允许登录</option><option value="disabled">禁止登录</option><option value="missing">未开通账号</option></select>
        <span>{filteredRows.length} 名人员</span>
      </div>
      {filteredRows.length ? <AdaptiveDataList label="人员与权限列表" className="account-data-list people-access-list" columns={accountColumns}>
        {filteredRows.map(({ person, account }) => {
          const rowSaving = savingPersonIds.has(person.id) || Boolean(account && savingAccountIds.has(account.id));
          return <AdaptiveDataRow className="account-data-row people-access-row" key={person.id}>
          <AdaptiveDataCell column="identity" className="account-data-primary"><div className="people-access-person-editor"><InlineTextCell revision={person.updatedAt} revisionSubject="人员" onReloadRevision={async () => (await reloadPerson(person.id)).updatedAt} disabled={rowSaving} value={person.name} label="人员姓名" required onSave={(name, expectedUpdatedAt) => savePerson(person, { name }, expectedUpdatedAt)} /><InlineTextCell revision={person.updatedAt} revisionSubject="人员" onReloadRevision={async () => (await reloadPerson(person.id)).updatedAt} disabled={rowSaving} value={person.jobTitle} label="岗位" placeholder="岗位未设置" onSave={(value, expectedUpdatedAt) => savePerson(person, { jobTitle: value || null }, expectedUpdatedAt)} renderValue={(value) => <small>{value}</small>} /></div></AdaptiveDataCell>
          <AdaptiveDataCell column="account" className="account-data-account"><DataCell primary={account ? <InlineTextCell revision={account.updatedAt} revisionSubject="账号" onReloadRevision={async () => (await reloadAccount(account.id)).updatedAt} disabled={rowSaving} value={account.username} label="登录名" required onSave={(username, expectedUpdatedAt) => saveAccount(account, { username }, expectedUpdatedAt)} /> : <span className="account-missing"><UserRoundCheck size={15} />未开通账号</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="permission" className="account-data-permission"><DataCell primary={account ? <AccountPermissionEditor account={account} disabled={rowSaving} onSave={(input, expectedUpdatedAt) => saveAccount(account, input, expectedUpdatedAt)} onReload={() => reloadAccount(account.id)} /> : <span className="account-muted">开通账号后配置</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="status" className="account-data-status"><DataCell primary={account ? <InlineSelectCell revision={account.updatedAt} revisionSubject="账号" onReloadRevision={async () => (await reloadAccount(account.id)).updatedAt} disabled={rowSaving} value={account.status} label="登录状态" options={accountStatusOptions} displayMode="badge" onSave={async (status, _reason, expectedUpdatedAt) => {
            const total = account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues;
            if (status === 'disabled' && total > 0) { openConfirmation({ kind: 'toggle', account, nextStatus: status }); return; }
            await saveAccount(account, { status }, expectedUpdatedAt);
          }} renderValue={(value) => <StatusBadge kind="account" value={value} />} /> : <span className="account-status missing">未开通</span>}
            secondary={account?.mustChangePassword || account?.status === 'disabled' && account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues > 0 ? <>{account?.mustChangePassword && <span className="account-password-state">待修改初始密码</span>}{account?.status === 'disabled' && account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues > 0 && <span className="account-assignment-warning">仍有待处理任务</span>}</> : undefined} /></AdaptiveDataCell>
          <AdaptiveDataCell column="login" className="account-data-login"><DataCell primary={account ? account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('zh-CN') : '从未登录' : '—'} /></AdaptiveDataCell>
          <AdaptiveDataCell column="actions" className="account-data-actions"><AccountActions account={account} person={person} currentAccountId={session.accountId} pending={pending || rowSaving}
            onReset={account ? () => openConfirmation({ kind: 'reset', account }) : undefined}
            onToggleLogin={account ? () => {
              const nextStatus = account.status === 'active' ? 'disabled' : 'active';
              if (nextStatus === 'disabled') { openConfirmation({ kind: 'toggle', account, nextStatus }); return; }
              if (!accountSavingRef.current.has(account.id)) void saveAccount(account, { status: nextStatus }).catch((error) => setResult({ title: '更新登录状态失败', message: error instanceof Error ? error.message : '更新登录状态失败', error: true }));
            } : undefined}
            onDelete={account ? () => openConfirmation({ kind: 'delete', account }) : undefined}
            onOpen={!account ? () => { if (!personSavingRef.current.has(person.id)) openAccountLock.run(() => openAccount.mutate(person)); } : undefined}
            onArchive={() => openConfirmation({ kind: 'archive', person, account })} /></AdaptiveDataCell>
        </AdaptiveDataRow>;
        })}
      </AdaptiveDataList> : !peopleQuery.isLoading && !accountsQuery.isLoading && <EmptyState title="没有符合条件的人员" detail={rows.length ? '请调整搜索或筛选条件。' : '新增人员后会自动创建登录账号。'} />}
      </>}
    </div>
    {creating && <NewPersonForm onClose={() => setCreating(false)} />}
    {confirmation && <ConfirmDialog
      title={{ reset: '重置账号密码', delete: '删除登录账号', toggle: '禁止账号登录', archive: '归档人员' }[confirmation.kind]}
      description={confirmation.kind === 'reset'
        ? <>将“<strong>{confirmation.account.username}</strong>”的密码重置为系统初始密码？该用户下次登录时必须修改密码。</>
        : confirmation.kind === 'delete'
          ? <>删除账号“<strong>{confirmation.account.username}</strong>”后将立即停止登录并撤销其 Token，但人员、项目角色和历史记录会保留。{confirmation.account.activeAssignments.requirements + confirmation.account.activeAssignments.workItems + confirmation.account.activeAssignments.issues > 0 && <p>当前仍关联需求 {confirmation.account.activeAssignments.requirements} 项、工作项 {confirmation.account.activeAssignments.workItems} 项、问题 {confirmation.account.activeAssignments.issues} 项。</p>}</>
          : confirmation.kind === 'toggle'
            ? <>禁止“<strong>{confirmation.account.username}</strong>”登录会注销其现有会话，恢复后需重新登录，不会重新分配其任务。当前关联需求 {confirmation.account.activeAssignments.requirements} 项、工作项 {confirmation.account.activeAssignments.workItems} 项、问题 {confirmation.account.activeAssignments.issues} 项。</>
            : <>归档人员“<strong>{confirmation.person.name}</strong>”？如仍有未完成任务，系统会阻止归档并提示需要重新分配的内容。</>}
      confirmLabel={{ reset: '确认重置', delete: '删除账号', toggle: '禁止登录', archive: '确认归档' }[confirmation.kind]}
      pendingLabel="处理中…"
      danger={confirmation.kind !== 'reset'}
      pending={pending}
      disabled={Boolean(confirmationInvalidReason)}
      error={confirmationError}
      onClose={() => { if (!pending) { setConfirmation(null); setActionError(''); setConfirmationNeedsReopen(false); } }}
      onConfirm={() => void runConfirmedAction()}
    />}
    {result && <ResultDialog title={result.title} message={result.message} value={result.value} error={result.error} onClose={() => setResult(null)} />}
  </>;
}

export const AccountsPage = PeopleAccessPage;
