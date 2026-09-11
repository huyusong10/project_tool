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
type AccountStatusRecheck = { account: Account; nextStatus: Account['status'] };
type AccountProfileRecheck = { account: Account; username?: string; role?: Account['globalRole'] };
type PersonProfileRecheck = { person: Person; name?: string; jobTitle?: string | null; hasJobTitle: boolean };
type CreatePersonInput = { name: string; jobTitle: string };
type CreatePersonRecheck = { input: CreatePersonInput; initialPersonIds: string[] | null };
type AccessRecheckKind = 'create-person' | 'open' | 'reset' | 'remove' | 'archive' | 'status' | 'account-profile' | 'person-profile';

const emptyPeople: Person[] = [];
const emptyAccounts: Account[] = [];

const errorMessage = (error: unknown) => error instanceof Error ? error.message : undefined;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isStoredAccount = (value: unknown): value is Account => isRecord(value)
  && typeof value.id === 'string' && typeof value.username === 'string' && typeof value.updatedAt === 'string';
const isStoredPerson = (value: unknown): value is Person => isRecord(value)
  && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.updatedAt === 'string';
const isStoredAccountStatus = (value: unknown): value is AccountStatusRecheck => isRecord(value)
  && isStoredAccount(value.account) && (value.nextStatus === 'active' || value.nextStatus === 'disabled');
const isStoredAccountProfile = (value: unknown): value is AccountProfileRecheck => isRecord(value)
  && isStoredAccount(value.account)
  && (value.username === undefined || typeof value.username === 'string')
  && (value.role === undefined || value.role === 'user' || value.role === 'admin');
const isStoredPersonProfile = (value: unknown): value is PersonProfileRecheck => isRecord(value)
  && isStoredPerson(value.person)
  && (value.name === undefined || typeof value.name === 'string')
  && (value.jobTitle === undefined || value.jobTitle === null || typeof value.jobTitle === 'string')
  && typeof value.hasJobTitle === 'boolean';
const isStoredCreatePerson = (value: unknown): value is CreatePersonRecheck => isRecord(value)
  && isRecord(value.input)
  && typeof value.input.name === 'string'
  && typeof value.input.jobTitle === 'string'
  && (value.initialPersonIds === null || Array.isArray(value.initialPersonIds) && value.initialPersonIds.every((id) => typeof id === 'string'));

function readAccessRecheck<T>(accountKey: string, kind: AccessRecheckKind, validate: (value: unknown) => value is T): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(`project-manage:access-recheck:${accountKey}:${kind}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validate(value) ? value : null;
  } catch {
    return null;
  }
}

function persistAccessRecheck(accountKey: string, kind: AccessRecheckKind, value: unknown | null) {
  if (typeof window === 'undefined') return;
  try {
    const key = `project-manage:access-recheck:${accountKey}:${kind}`;
    if (value) window.sessionStorage.setItem(key, JSON.stringify(value));
    else window.sessionStorage.removeItem(key);
  } catch {
    // 页面状态仍会保留锁；存储不可用时只失去跨导航恢复能力。
  }
}

function useAccessRecheck<T>(accountKey: string, kind: AccessRecheckKind, validate: (value: unknown) => value is T) {
  const [value, setValueState] = useState<T | null>(() => readAccessRecheck(accountKey, kind, validate));
  const setValue = (next: T | null) => {
    persistAccessRecheck(accountKey, kind, next);
    setValueState(next);
  };
  useEffect(() => {
    setValueState(readAccessRecheck(accountKey, kind, validate));
  }, [accountKey, kind, validate]);
  return [value, setValue] as const;
}

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
    <button type="button" className="account-actions-trigger" aria-label={`打开${name}操作`} aria-expanded={open} disabled={pending} onClick={() => { if (!pending) setOpen((value) => !value); }}><MoreHorizontal size={17} /></button>
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

function NewPersonForm({ recheck, onRecheckChange, onClose }: {
  recheck: CreatePersonRecheck | null;
  onRecheckChange: (value: CreatePersonRecheck | null) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const mounted = useRef(true);
  const [recheckPending, setRecheckPending] = useState(false);
  const [recheckError, setRecheckError] = useState("");
  const needsRecheck = Boolean(recheck);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const initialPersonIds = useRef<Set<string> | null | undefined>(undefined);
  if (initialPersonIds.current === undefined) {
    if (recheck) {
      initialPersonIds.current = recheck.initialPersonIds ? new Set(recheck.initialPersonIds) : null;
    } else {
      const queryKey = [...keys.people, 'all'];
      const cached = client.getQueryData<Person[]>(queryKey);
      initialPersonIds.current = client.getQueryState(queryKey)?.status === 'success' && cached
        ? new Set(cached.map((person) => person.id))
        : null;
    }
  }
  const mutation = useMutation({
    mutationFn: (input: CreatePersonInput) => api<Person>('/api/people', { method: 'POST', body: jsonBody(input) }),
    onMutate: (input) => {
      const sourceIds = initialPersonIds.current;
      onRecheckChange({ input, initialPersonIds: sourceIds ? [...sourceIds] : null });
      setRecheckError("");
    },
    onSuccess: () => {
      onRecheckChange(null);
      invalidateAccountViews(client);
      onClose();
    },
    onError: async (error, input) => {
      const sourceIds = initialPersonIds.current;
      if (!requiresWriteRecheck(error)) { onRecheckChange(null); return; }
      if (!sourceIds) return;
      try {
        const latest = await api<Person[]>('/api/people', { readOnly: true });
        client.setQueryData([...keys.people, 'all'], latest);
        const matches = latest.filter((person) => !sourceIds.has(person.id)
          && person.name === canonicalizeLabel(input.name)
          && person.jobTitle === (canonicalizeLabel(input.jobTitle) || null)
          && Boolean(person.active));
        if (matches.length === 1) {
          onRecheckChange(null);
          invalidateAccountViews(client);
          if (mounted.current) {
            toast.success('已核对最新状态：人员和账号已创建');
            onClose();
          }
        } else if (matches.length === 0) {
          onRecheckChange(null);
          if (mounted.current) toast.info('已核对最新状态：未发现本次新增人员，可以重新提交');
        } else if (mounted.current) {
          setRecheckError('发现多个匹配人员，请重新读取后在列表核对。');
        }
      } catch {
        // 保留提交前人员基线、原草稿和跨导航锁。
      }
    },
  });
  const lock = useSynchronousPendingLock(mutation.isPending);
  const reloadPeople = async () => {
    const pendingRecheck = recheck;
    if (!pendingRecheck || recheckPending) return;
    const sourceIds = pendingRecheck.initialPersonIds ? new Set(pendingRecheck.initialPersonIds) : null;
    const input = pendingRecheck.input;
    setRecheckPending(true);
    setRecheckError("");
    try {
      const latest = await api<Person[]>('/api/people', { readOnly: true });
      client.setQueryData([...keys.people, 'all'], latest);
      const matches = sourceIds ? latest.filter((person) => !sourceIds.has(person.id)
        && person.name === canonicalizeLabel(input.name)
        && person.jobTitle === (canonicalizeLabel(input.jobTitle) || null)
        && Boolean(person.active)) : [];
      if (matches.length === 1) {
        onRecheckChange(null);
        mutation.reset();
        invalidateAccountViews(client);
        toast.success('已核对最新状态：人员和账号已创建');
        onClose();
      } else if (sourceIds && matches.length === 0) {
        onRecheckChange(null);
        mutation.reset();
        toast.info('已核对最新状态：未发现本次新增人员，可以重新提交');
      } else {
        onRecheckChange(null);
        mutation.reset();
        invalidateAccountViews(client);
        toast.info(sourceIds ? '发现多个匹配人员，请在列表核对' : '已重新读取人员，请在列表核对创建结果');
        onClose();
      }
    } catch (caught) {
      setRecheckError(caught instanceof Error ? caught.message : "人员列表读取失败");
    } finally {
      setRecheckPending(false);
    }
  };
  const close = () => {
    if (lock.canClose() && !recheckPending) onClose();
  };
  const formBusy = lock.busy || needsRecheck || recheckPending;
  return <Modal title="新增人员" width={520} closable={!lock.busy && !recheckPending} onClose={close}><form className="form-grid" onSubmit={(event) => {
    event.preventDefault();
    if (needsRecheck || recheckPending) return;
    const data = new FormData(event.currentTarget);
    lock.run(() => mutation.mutate({ name: String(data.get('name') || ''), jobTitle: String(data.get('jobTitle') || '') }));
  }}>
    <FormField label="姓名" full><input name="name" required autoFocus disabled={formBusy} defaultValue={recheck?.input.name} /></FormField>
    <FormField label="岗位" full><input name="jobTitle" disabled={formBusy} defaultValue={recheck?.input.jobTitle} placeholder="例如：前端工程师、测试工程师" /></FormField>
    <p className="field-help field-full">保存后自动创建普通账号，初始密码为 888888。</p>
    <FormError>{needsRecheck ? `新增人员结果待核对，当前草稿不会重复提交。${recheckError ? ` ${recheckError}` : ""}` : mutation.error?.message}</FormError>
    {needsRecheck && <div className="field-full"><button type="button" className="ghost-button" disabled={recheckPending} onClick={() => void reloadPeople()}>{recheckPending ? "读取中…" : "重新读取人员"}</button></div>}
    <FormSubmitActions submitLabel="新增人员" pendingLabel={recheckPending ? "读取中…" : "保存中…"} cancelLabel={needsRecheck ? "关闭并核对" : "取消"} onCancel={close} pending={lock.busy || recheckPending} disabled={needsRecheck} />
  </form></Modal>;
}

export function PeopleAccessPage() {
  const client = useQueryClient();
  const toast = useToast();
  const { session } = useSession();
  const recheckAccountKey = session.accountId || session.username || 'guest';
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
  const [createPersonNeedsRecheck, setCreatePersonNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'create-person', isStoredCreatePerson);
  const [openAccountNeedsRecheck, setOpenAccountNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'open', isStoredPerson);
  const [openAccountRechecking, setOpenAccountRechecking] = useState(false);
  const [resetNeedsRecheck, setResetNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'reset', isStoredAccount);
  const [resetRechecking, setResetRechecking] = useState(false);
  const [removeAccountNeedsRecheck, setRemoveAccountNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'remove', isStoredAccount);
  const [removeAccountRechecking, setRemoveAccountRechecking] = useState(false);
  const [archivePersonNeedsRecheck, setArchivePersonNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'archive', isStoredPerson);
  const [archivePersonRechecking, setArchivePersonRechecking] = useState(false);
  const [accountStatusNeedsRecheck, setAccountStatusNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'status', isStoredAccountStatus);
  const [accountStatusRechecking, setAccountStatusRechecking] = useState(false);
  const [accountProfileNeedsRecheck, setAccountProfileNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'account-profile', isStoredAccountProfile);
  const [accountProfileRechecking, setAccountProfileRechecking] = useState(false);
  const [personProfileNeedsRecheck, setPersonProfileNeedsRecheck] = useAccessRecheck(recheckAccountKey, 'person-profile', isStoredPersonProfile);
  const [personProfileRechecking, setPersonProfileRechecking] = useState(false);
  const accountActionRecheckLocked = Boolean(openAccountNeedsRecheck || resetNeedsRecheck || removeAccountNeedsRecheck || archivePersonNeedsRecheck || accountStatusNeedsRecheck);
  const accountProfileRecheckLocked = Boolean(accountProfileNeedsRecheck);
  const accountStatusRecheckLocked = Boolean(accountStatusNeedsRecheck);
  const personProfileRecheckLocked = Boolean(personProfileNeedsRecheck);
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
      setResetNeedsRecheck(null);
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
            setResetNeedsRecheck(null);
            setConfirmation(null);
            setResult({
              title: '密码已重置',
              message: '已核对最新状态：该用户下次登录时必须修改初始密码。',
              value: '888888',
            });
            return;
          }
        } catch {
          setResetNeedsRecheck(account);
        }
      }
      lockConfirmationAfterError(error);
    },
    onSettled: () => { confirmationSubmitting.current = false; },
  });
  const reloadResetAccount = async () => {
    const account = resetNeedsRecheck;
    if (!account || resetRechecking) return;
    setResetRechecking(true);
    try {
      const latestAccounts = await accountsQuery.refetch({ throwOnError: true });
      const latest = latestAccounts.data?.find((entry) => entry.id === account.id);
      setResetNeedsRecheck(null);
      setConfirmation(null);
      setConfirmationNeedsReopen(false);
      reset.reset();
      if (latest && latest.updatedAt !== account.updatedAt && latest.mustChangePassword) {
        refresh();
        setResult({
          title: '密码已重置',
          message: '已核对最新状态：该用户下次登录时必须修改初始密码。',
          value: '888888',
        });
      } else {
        toast.info('已核对最新状态：未发现本次密码重置，可以重新操作');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '账号列表读取失败');
    } finally {
      setResetRechecking(false);
    }
  };
  const removeAccount = useMutation({
    mutationFn: (account: Account) => api<{ ok: true }>(`/api/accounts/${account.id}`, { method: 'DELETE', body: jsonBody({ expectedUpdatedAt: account.updatedAt }) }),
    onSuccess: () => { setRemoveAccountNeedsRecheck(null); refresh(); setConfirmation(null); },
    onError: async (error, account) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latestAccounts = await api<Account[]>('/api/accounts', { readOnly: true });
          client.setQueryData(keys.accounts, latestAccounts);
          refresh();
          if (!latestAccounts.some((entry) => entry.id === account.id)) {
            setRemoveAccountNeedsRecheck(null);
            setConfirmation(null);
            return;
          }
        } catch {
          setRemoveAccountNeedsRecheck(account);
        }
      }
      lockConfirmationAfterError(error);
    },
    onSettled: () => { confirmationSubmitting.current = false; },
  });
  const reloadRemovedAccount = async () => {
    const account = removeAccountNeedsRecheck;
    if (!account || removeAccountRechecking) return;
    setRemoveAccountRechecking(true);
    try {
      const latestAccounts = await accountsQuery.refetch({ throwOnError: true });
      const latest = latestAccounts.data?.find((entry) => entry.id === account.id);
      setRemoveAccountNeedsRecheck(null);
      setConfirmation(null);
      setConfirmationNeedsReopen(false);
      removeAccount.reset();
      if (!latest) {
        refresh();
        toast.success('已核对最新状态：账号已删除');
      } else {
        toast.info('已核对最新状态：账号仍存在，可以重新操作');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '账号列表读取失败');
    } finally {
      setRemoveAccountRechecking(false);
    }
  };
  const openAccount = useMutation({
    mutationFn: (person: Person) => api<OpenAccountResult>(`/api/people/${person.id}/account`, {
      method: 'POST', body: jsonBody({ expectedAccountDeletedAt: person.accountDeletedAt || null }),
    }),
    onSuccess: (response) => {
      setOpenAccountNeedsRecheck(null);
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
            setOpenAccountNeedsRecheck(null);
            setResult({
              title: '账号已开通',
              message: `已核对最新状态：账号“${opened.username}”已经可以登录，下次登录时必须修改初始密码。`,
              value: '888888',
            });
            return;
          }
        } catch {
          setOpenAccountNeedsRecheck(person);
          setResult({
            title: '开通账号结果待核对',
            message: '账号可能已经开通，但账号列表读取失败。关闭后请重新读取账号，本页面不会重复提交。',
            error: true,
          });
          return;
        }
      }
      if (requiresWriteRecheck(error)) refresh();
      setResult({ title: '开通账号失败', message: error instanceof Error ? error.message : '开通账号失败', error: true });
    },
  });
  const openAccountLock = useSynchronousPendingLock(openAccount.isPending);
  const reloadOpenedAccount = async () => {
    const person = openAccountNeedsRecheck;
    if (!person || openAccountRechecking) return;
    setOpenAccountRechecking(true);
    try {
      const latest = await accountsQuery.refetch({ throwOnError: true });
      const opened = latest.data?.find((account) => account.personId === person.id
        && account.status === 'active'
        && account.mustChangePassword);
      setOpenAccountNeedsRecheck(null);
      openAccount.reset();
      if (opened) {
        refresh();
        setResult({
          title: '账号已开通',
          message: `已核对最新状态：账号“${opened.username}”已经可以登录，下次登录时必须修改初始密码。`,
          value: '888888',
        });
      } else {
        setResult(null);
        toast.info('已核对最新状态：未发现该人员的新账号，可以重新开通');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '账号列表读取失败');
    } finally {
      setOpenAccountRechecking(false);
    }
  };
  const archivePerson = useMutation({
    mutationFn: (person: Person) => api(`/api/people/${person.id}`, { method: 'DELETE', body: jsonBody({ expectedUpdatedAt: person.updatedAt }) }),
    onSuccess: () => { setArchivePersonNeedsRecheck(null); setConfirmation(null); invalidateArchiveViews(client); },
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
            setArchivePersonNeedsRecheck(null);
            setConfirmation(null);
            invalidateArchiveViews(client);
            return;
          }
        } catch {
          setArchivePersonNeedsRecheck(person);
        }
      }
      lockConfirmationAfterError(error);
    },
    onSettled: () => { confirmationSubmitting.current = false; },
  });
  const reloadArchivedPerson = async () => {
    const person = archivePersonNeedsRecheck;
    if (!person || archivePersonRechecking) return;
    setArchivePersonRechecking(true);
    try {
      const [latestPeople, latestArchives] = await Promise.all([
        api<Person[]>('/api/people', { readOnly: true }),
        api<Archives>('/api/archives', { readOnly: true }),
      ]);
      client.setQueryData([...keys.people, 'all'], latestPeople);
      client.setQueryData(keys.archives, latestArchives);
      const active = latestPeople.some((entry) => entry.id === person.id);
      const archived = latestArchives.people.some((entry) => entry.id === person.id);
      if (active === archived) {
        toast.error('人员与归档列表状态不一致，请稍后重新读取');
        return;
      }
      setArchivePersonNeedsRecheck(null);
      setConfirmation(null);
      setConfirmationNeedsReopen(false);
      archivePerson.reset();
      if (archived) {
        invalidateArchiveViews(client);
        toast.success('已核对最新状态：人员已归档');
      } else {
        toast.info('已核对最新状态：人员仍在活动列表，可以重新操作');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '人员或归档列表读取失败');
    } finally {
      setArchivePersonRechecking(false);
    }
  };
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
    const changesStatus = input.status === 'active' || input.status === 'disabled';
    const changesProfile = typeof input.username === 'string' || input.role === 'user' || input.role === 'admin';
    if (changesStatus && accountStatusNeedsRecheck) throw new Error('登录状态结果待核对，请先重新读取账号');
    if (changesProfile && accountProfileNeedsRecheck) throw new Error('账号资料结果待核对，请先重新读取账号');
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
            if (desiredStatus === 'active' || desiredStatus === 'disabled') {
              setAccountStatusNeedsRecheck({ account, nextStatus: desiredStatus });
            } else if (desiredUsername !== undefined || desiredRole !== undefined) {
              setAccountProfileNeedsRecheck({ account, username: desiredUsername, role: desiredRole });
            }
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
    if (personProfileNeedsRecheck) throw new Error('人员资料结果待核对，请先重新读取人员资料');
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
            setPersonProfileNeedsRecheck({ person, name: desiredName, jobTitle: desiredJobTitle, hasJobTitle });
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
    if (target.kind === 'reset' && resetNeedsRecheck
      || target.kind === 'delete' && removeAccountNeedsRecheck
      || target.kind === 'toggle' && accountStatusNeedsRecheck
      || target.kind === 'archive' && archivePersonNeedsRecheck) return;
    const targetAccount = target.account;
    const targetPersonId = target.kind === 'archive' ? target.person.id : target.account.personId;
    if (targetAccount && (resetNeedsRecheck?.id === targetAccount.id || removeAccountNeedsRecheck?.id === targetAccount.id || accountStatusNeedsRecheck?.account.id === targetAccount.id || accountProfileNeedsRecheck?.account.id === targetAccount.id)) return;
    if (archivePersonNeedsRecheck?.id === targetPersonId || personProfileNeedsRecheck?.person.id === targetPersonId) return;
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
      setAccountStatusNeedsRecheck(null);
      setConfirmation(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '更新登录状态失败');
      lockConfirmationAfterError(error);
    } finally { confirmationSubmitting.current = false; setManualPending(false); }
  };
  const reloadAccountStatus = async () => {
    const pendingStatus = accountStatusNeedsRecheck;
    if (!pendingStatus || accountStatusRechecking) return;
    setAccountStatusRechecking(true);
    try {
      const latestAccounts = await accountsQuery.refetch({ throwOnError: true });
      const latest = latestAccounts.data?.find((entry) => entry.id === pendingStatus.account.id);
      setAccountStatusNeedsRecheck(null);
      setConfirmation(null);
      setConfirmationNeedsReopen(false);
      setActionError('');
      if (!latest) {
        toast.info('已核对最新状态：账号已不存在');
      } else if (latest.status === pendingStatus.nextStatus) {
        refresh();
        toast.success(`已核对最新状态：账号已${latest.status === 'disabled' ? '禁止' : '允许'}登录`);
      } else {
        toast.info('已核对最新状态：登录状态未变更，可以重新操作');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '账号列表读取失败');
    } finally {
      setAccountStatusRechecking(false);
    }
  };
  const reloadAccountProfile = async () => {
    const pendingProfile = accountProfileNeedsRecheck;
    if (!pendingProfile || accountProfileRechecking) return;
    setAccountProfileRechecking(true);
    try {
      const latestAccounts = await accountsQuery.refetch({ throwOnError: true });
      const latest = latestAccounts.data?.find((entry) => entry.id === pendingProfile.account.id);
      setAccountProfileNeedsRecheck(null);
      if (!latest) {
        toast.info('已核对最新状态：账号已不存在');
      } else if ((pendingProfile.username === undefined || canonicalizeLabel(latest.username) === pendingProfile.username)
        && (pendingProfile.role === undefined || latest.globalRole === pendingProfile.role)) {
        refresh();
        toast.success('已核对最新状态：账号资料已更新');
      } else {
        toast.info('已核对最新状态：账号资料未变更，可以重新编辑');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '账号列表读取失败');
    } finally {
      setAccountProfileRechecking(false);
    }
  };
  const reloadPersonProfile = async () => {
    const pendingProfile = personProfileNeedsRecheck;
    if (!pendingProfile || personProfileRechecking) return;
    setPersonProfileRechecking(true);
    try {
      const latestPeople = await peopleQuery.refetch({ throwOnError: true });
      const latest = latestPeople.data?.find((entry) => entry.id === pendingProfile.person.id);
      setPersonProfileNeedsRecheck(null);
      if (!latest) {
        toast.info('已核对最新状态：人员已不在活动列表');
      } else if ((pendingProfile.name === undefined || canonicalizeLabel(latest.name) === pendingProfile.name)
        && (!pendingProfile.hasJobTitle || latest.jobTitle === pendingProfile.jobTitle)) {
        invalidateAccountViews(client);
        toast.success('已核对最新状态：人员资料已更新');
      } else {
        toast.info('已核对最新状态：人员资料未变更，可以重新编辑');
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : '人员列表读取失败');
    } finally {
      setPersonProfileRechecking(false);
    }
  };
  const confirmationError = confirmationInvalidReason || actionError || (confirmation?.kind === 'reset' ? errorMessage(reset.error)
    : confirmation?.kind === 'delete' ? errorMessage(removeAccount.error)
      : confirmation?.kind === 'archive' ? errorMessage(archivePerson.error) : undefined);
  const pending = reset.isPending || removeAccount.isPending || openAccountLock.busy || archivePerson.isPending || manualPending;

  return <>
    <PageHeader title="人员与权限" actions={<button className="primary-button" onClick={() => setCreating(true)}><UserPlus size={16} />{createPersonNeedsRecheck ? '核对新增人员' : '新增人员'}</button>} />
    <div className="page-content accounts-page people-access-page">
      {!dataReady && loadError ? <EmptyState title="人员与权限加载失败" detail={loadError.message || '暂时无法读取人员与账号，请稍后重试。'} action={<button className="ghost-button" disabled={peopleQuery.isFetching || accountsQuery.isFetching} onClick={retry}>重新加载</button>} />
        : !dataReady ? <LoadingState label="正在加载人员与权限…" className="stable-panel-state" /> : <>
      {loadError && <div className="warning-banner">数据刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={peopleQuery.isFetching || accountsQuery.isFetching} onClick={retry}>重新加载</button></div>}
      {createPersonNeedsRecheck && <div role="alert" className="warning-banner">“{createPersonNeedsRecheck.input.name.trim()}”的新增人员结果待核对，原草稿已锁定。<button className="ghost-button" onClick={() => setCreating(true)}>继续核对</button></div>}
      {openAccountNeedsRecheck && <div role="alert" className="warning-banner">“{openAccountNeedsRecheck.name}”的开通账号结果待核对，旧入口已锁定。<button className="ghost-button" disabled={openAccountRechecking} onClick={() => void reloadOpenedAccount()}>{openAccountRechecking ? "读取中…" : "重新读取账号"}</button></div>}
      {resetNeedsRecheck && <div role="alert" className="warning-banner">“{resetNeedsRecheck.username}”的密码重置结果待核对，旧账号版本已锁定。<button className="ghost-button" disabled={resetRechecking} onClick={() => void reloadResetAccount()}>{resetRechecking ? "读取中…" : "重新读取账号"}</button></div>}
      {removeAccountNeedsRecheck && <div role="alert" className="warning-banner">“{removeAccountNeedsRecheck.username}”的删除账号结果待核对，旧账号版本已锁定。<button className="ghost-button" disabled={removeAccountRechecking} onClick={() => void reloadRemovedAccount()}>{removeAccountRechecking ? "读取中…" : "重新读取账号"}</button></div>}
      {archivePersonNeedsRecheck && <div role="alert" className="warning-banner">“{archivePersonNeedsRecheck.name}”的人员归档结果待核对，旧人员版本已锁定。<button className="ghost-button" disabled={archivePersonRechecking} onClick={() => void reloadArchivedPerson()}>{archivePersonRechecking ? "读取中…" : "重新读取归档状态"}</button></div>}
      {accountStatusNeedsRecheck && <div role="alert" className="warning-banner">“{accountStatusNeedsRecheck.account.username}”的登录状态结果待核对，旧账号版本已锁定。<button className="ghost-button" disabled={accountStatusRechecking} onClick={() => void reloadAccountStatus()}>{accountStatusRechecking ? "读取中…" : "重新读取登录状态"}</button></div>}
      {accountProfileNeedsRecheck && <div role="alert" className="warning-banner">“{accountProfileNeedsRecheck.account.username}”的账号资料结果待核对，旧账号版本已锁定。<button className="ghost-button" disabled={accountProfileRechecking} onClick={() => void reloadAccountProfile()}>{accountProfileRechecking ? "读取中…" : "重新读取账号资料"}</button></div>}
      {personProfileNeedsRecheck && <div role="alert" className="warning-banner">“{personProfileNeedsRecheck.person.name}”的人员资料结果待核对，旧人员版本已锁定。<button className="ghost-button" disabled={personProfileRechecking} onClick={() => void reloadPersonProfile()}>{personProfileRechecking ? "读取中…" : "重新读取人员资料"}</button></div>}
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
          const openingNeedsRecheck = openAccountNeedsRecheck?.id === person.id;
          const resettingNeedsRecheck = Boolean(account && resetNeedsRecheck?.id === account.id);
          const removingNeedsRecheck = Boolean(account && removeAccountNeedsRecheck?.id === account.id);
          const archivingNeedsRecheck = archivePersonNeedsRecheck?.id === person.id;
          const statusNeedsRecheck = Boolean(account && accountStatusNeedsRecheck?.account.id === account.id);
          const profileNeedsRecheck = Boolean(account && accountProfileNeedsRecheck?.account.id === account.id);
          const personNeedsRecheck = personProfileNeedsRecheck?.person.id === person.id;
          const rowLocked = rowSaving || openingNeedsRecheck || resettingNeedsRecheck || removingNeedsRecheck || archivingNeedsRecheck || statusNeedsRecheck || profileNeedsRecheck || personNeedsRecheck;
          return <AdaptiveDataRow className="account-data-row people-access-row" key={person.id}>
          <AdaptiveDataCell column="identity" className="account-data-primary"><div className="people-access-person-editor"><InlineTextCell revision={person.updatedAt} revisionSubject="人员" onReloadRevision={async () => (await reloadPerson(person.id)).updatedAt} disabled={rowLocked || personProfileRecheckLocked} value={person.name} label="人员姓名" required onSave={(name, expectedUpdatedAt) => savePerson(person, { name }, expectedUpdatedAt)} /><InlineTextCell revision={person.updatedAt} revisionSubject="人员" onReloadRevision={async () => (await reloadPerson(person.id)).updatedAt} disabled={rowLocked || personProfileRecheckLocked} value={person.jobTitle} label="岗位" placeholder="岗位未设置" onSave={(value, expectedUpdatedAt) => savePerson(person, { jobTitle: value || null }, expectedUpdatedAt)} renderValue={(value) => <small>{value}</small>} /></div></AdaptiveDataCell>
          <AdaptiveDataCell column="account" className="account-data-account"><DataCell primary={account ? <InlineTextCell revision={account.updatedAt} revisionSubject="账号" onReloadRevision={async () => (await reloadAccount(account.id)).updatedAt} disabled={rowLocked || accountProfileRecheckLocked} value={account.username} label="登录名" required onSave={(username, expectedUpdatedAt) => saveAccount(account, { username }, expectedUpdatedAt)} /> : <span className="account-missing"><UserRoundCheck size={15} />未开通账号</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="permission" className="account-data-permission"><DataCell primary={account ? <AccountPermissionEditor account={account} disabled={rowLocked || accountProfileRecheckLocked} onSave={(input, expectedUpdatedAt) => saveAccount(account, input, expectedUpdatedAt)} onReload={() => reloadAccount(account.id)} /> : <span className="account-muted">开通账号后配置</span>} /></AdaptiveDataCell>
          <AdaptiveDataCell column="status" className="account-data-status"><DataCell primary={account ? <InlineSelectCell revision={account.updatedAt} revisionSubject="账号" onReloadRevision={async () => (await reloadAccount(account.id)).updatedAt} disabled={rowLocked || accountStatusRecheckLocked} value={account.status} label="登录状态" options={accountStatusOptions} displayMode="badge" onSave={async (status, _reason, expectedUpdatedAt) => {
            const total = account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues;
            if (status === 'disabled' && total > 0) { openConfirmation({ kind: 'toggle', account, nextStatus: status }); return; }
            await saveAccount(account, { status }, expectedUpdatedAt);
          }} renderValue={(value) => <StatusBadge kind="account" value={value} />} /> : <span className="account-status missing">未开通</span>}
            secondary={account?.mustChangePassword || account?.status === 'disabled' && account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues > 0 ? <>{account?.mustChangePassword && <span className="account-password-state">待修改初始密码</span>}{account?.status === 'disabled' && account.activeAssignments.requirements + account.activeAssignments.workItems + account.activeAssignments.issues > 0 && <span className="account-assignment-warning">仍有待处理任务</span>}</> : undefined} /></AdaptiveDataCell>
          <AdaptiveDataCell column="login" className="account-data-login"><DataCell primary={account ? account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('zh-CN') : '从未登录' : '—'} /></AdaptiveDataCell>
          <AdaptiveDataCell column="actions" className="account-data-actions"><AccountActions account={account} person={person} currentAccountId={session.accountId} pending={pending || rowLocked || accountActionRecheckLocked}
            onReset={account ? () => openConfirmation({ kind: 'reset', account }) : undefined}
            onToggleLogin={account ? () => {
              const nextStatus = account.status === 'active' ? 'disabled' : 'active';
              if (nextStatus === 'disabled') { openConfirmation({ kind: 'toggle', account, nextStatus }); return; }
              if (!accountSavingRef.current.has(account.id)) void saveAccount(account, { status: nextStatus }).catch((error) => setResult({ title: '更新登录状态失败', message: error instanceof Error ? error.message : '更新登录状态失败', error: true }));
            } : undefined}
            onDelete={account ? () => openConfirmation({ kind: 'delete', account }) : undefined}
            onOpen={!account ? () => { if (!openAccountNeedsRecheck && !personSavingRef.current.has(person.id)) openAccountLock.run(() => openAccount.mutate(person)); } : undefined}
            onArchive={() => openConfirmation({ kind: 'archive', person, account })} /></AdaptiveDataCell>
        </AdaptiveDataRow>;
        })}
      </AdaptiveDataList> : !peopleQuery.isLoading && !accountsQuery.isLoading && <EmptyState title="没有符合条件的人员" detail={rows.length ? '请调整搜索或筛选条件。' : '新增人员后会自动创建登录账号。'} />}
      </>}
    </div>
    {creating && <NewPersonForm recheck={createPersonNeedsRecheck} onRecheckChange={setCreatePersonNeedsRecheck} onClose={() => setCreating(false)} />}
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
