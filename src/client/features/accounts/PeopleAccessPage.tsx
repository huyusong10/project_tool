
import * as peopleApi from "../people/api";
import * as accountsApi from "./api";
import * as archivesApi from "../archives/api";
import { Button } from "../../components/Button";
import { Pagination } from "../../components/Pagination";
import { useListPagination } from "../../use-list-pagination";
import { usePageSearchParams, usePageScrollPosition } from "../../use-page-view";
import { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, UserRoundCheck } from 'lucide-react';
import { isWriteOutcomeUnknown, jsonBody, requiresWriteRecheck } from "../../api";
import { useSession } from "../../app-context";
import { invalidateArchiveViews, invalidateAccountPermissionViews, invalidateAccountViews, keys } from "../../query-keys";
import { useOptimisticMutation } from "../../use-optimistic-mutation";
import type { Account, Archives, Person } from "../../types";
import { AdaptiveDataCell, AdaptiveDataList, AdaptiveDataRow } from "../../components/AdaptiveDataList";
import { DataCell } from "../../components/LayoutPrimitives";
import { ConfirmDialog, ResultDialog, useSynchronousPendingLock } from "../../components/Modal";
import { EmptyState, LoadingState } from "../../components/Feedback";
import { PageHeader } from "../../components/PageHeader";

import { InlineSelectCell } from '../../components/inline-edit/select';
import { InlineTextCell } from '../../components/inline-edit/text';
import { InlineEditContext } from '../../components/inline-edit/shared';
import { accountRoleOptions, accountStatusOptions } from "../../ui-options";
import { canonicalizeLabel, matchesSearch, searchScore } from "../../../shared/search";
import { SearchInput } from "../../components/SearchInput";
import { StatusBadge } from "../../components/Badge";

import { useToast } from "../../components/Toast";

import { type AccessConfirmation, type AccessResult, useAccessRecheck, isStoredCreatePerson, isStoredPerson, isStoredAccount, isStoredAccountStatus, isStoredAccountProfile, isStoredPersonProfile, emptyPeople, emptyAccounts, type IdentityRow, personAccessKey, assignmentKey, type OpenAccountResult, errorMessage, accountColumns } from './model';
import { AccountPermissionEditor } from './AccountPermissionEditor';
import { AccountActions } from './AccountActions';
import { NewPersonForm } from './NewPersonForm';

export function PeopleAccessPage() {
  const client = useQueryClient();
  const toast = useToast();
  const { session } = useSession();
  const recheckAccountKey = session.accountId || session.username || 'guest';
  const [filters, setFilters] = usePageSearchParams(['q','jobTitle','role','loginStatus'], true);
  const keyword = filters.get('q') || '', jobTitle = filters.get('jobTitle') || 'all', role = filters.get('role') || 'all', loginStatus = filters.get('loginStatus') || 'all';
  const updateFilter = (key: string, value: string) => setFilters(current => { const next = new URLSearchParams(current); next.set(key, value); next.set('page', '1'); return next; });
  const setKeyword = (value: string) => updateFilter('q', value), setJobTitle = (value: string) => updateFilter('jobTitle', value), setRole = (value: string) => updateFilter('role', value), setLoginStatus = (value: string) => updateFilter('loginStatus', value);
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
  const peopleQuery = useQuery({ queryKey: [...keys.people, 'all'], queryFn: ({ signal }) => peopleApi.people<Person[]>({ signal }) });
  const accountsQuery = useQuery({ queryKey: keys.accounts, queryFn: ({ signal }) => accountsApi.accounts<Account[]>({ signal }) });
  const people = peopleQuery.data || emptyPeople;
  const accounts = accountsQuery.data || emptyAccounts;
  const dataReady = peopleQuery.data !== undefined && accountsQuery.data !== undefined;
  usePageScrollPosition(dataReady, true);
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

  const activeAnchor=useContext(InlineEditContext)?.activeAnchor;
  const editingRow=Boolean(activeAnchor?.closest('.people-access-row'));
  const [heldRowIds,setHeldRowIds]=useState<string[]>([]);
  useLayoutEffect(()=>{if(!editingRow)setHeldRowIds(filteredRows.map(row=>row.person.id));},[editingRow,filteredRows]);
  const displayedRows=useMemo(()=>{
    if(!editingRow)return filteredRows;
    const byId=new Map(rows.map(row=>[row.person.id,row]));
    return heldRowIds.flatMap(id=>{const row=byId.get(id);return row?[row]:[];});
  },[editingRow,filteredRows,heldRowIds,rows]);
  const heldOrder=editingRow&&(displayedRows.length!==filteredRows.length||displayedRows.some((row,index)=>row.person.id!==filteredRows[index]?.person.id));
  const pagination = useListPagination({ items: displayedRows, filterKey: JSON.stringify([keyword, jobTitle, role, loginStatus]), personal: true, ready: dataReady, loading: peopleQuery.isFetching || accountsQuery.isFetching });
  const refresh = () => {
    invalidateAccountPermissionViews(client);
  };
  const lockConfirmationAfterError = (caught: unknown) => {
    if (!requiresWriteRecheck(caught)) return;
    setConfirmationNeedsReopen(true);
    refresh();
  };
  const reset = useMutation({
    mutationFn: (account: Account) => accountsApi.accountsResetPassword<{ temporaryPassword: string }>(account.id, { method: 'POST', body: jsonBody({ expectedUpdatedAt: account.updatedAt }) }),
    onSuccess: (response) => {
      setResetNeedsRecheck(null);
      refresh();
      setConfirmation(null);
      setResult({ title: '密码已重置', message: '该用户下次登录时必须修改初始密码。', value: response.temporaryPassword });
    },
    onError: async (error, account) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latestAccounts = await accountsApi.accounts<Account[]>({ readOnly: true });
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
    mutationFn: (account: Account) => accountsApi.accountsById<{ ok: true }>(account.id, { method: 'DELETE', body: jsonBody({ expectedUpdatedAt: account.updatedAt }) }),
    onSuccess: () => { setRemoveAccountNeedsRecheck(null); refresh(); setConfirmation(null); },
    onError: async (error, account) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const latestAccounts = await accountsApi.accounts<Account[]>({ readOnly: true });
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
    mutationFn: (person: Person) => peopleApi.peopleAccount<OpenAccountResult>(person.id, {
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
          const latestAccounts = await accountsApi.accounts<Account[]>({ readOnly: true });
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
    mutationFn: (person: Person) => peopleApi.peopleById(person.id, { method: 'DELETE', body: jsonBody({ expectedUpdatedAt: person.updatedAt }) }),
    onSuccess: () => { setArchivePersonNeedsRecheck(null); setConfirmation(null); invalidateArchiveViews(client); },
    onError: async (error, person) => {
      if (isWriteOutcomeUnknown(error)) {
        try {
          const [latestPeople, latestArchives] = await Promise.all([
            peopleApi.people<Person[]>({ readOnly: true }),
            archivesApi.archives<Archives>({ readOnly: true }),
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
        peopleApi.people<Person[]>({ readOnly: true }),
        archivesApi.archives<Archives>({ readOnly: true }),
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
    request: ({ account, input }) => accountsApi.accountsById<Account>(account.id, { method: 'PATCH', body: jsonBody(input) }),
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
            const latestAccounts = await accountsApi.accounts<Account[]>({ readOnly: true });
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
    request: ({ person, input }) => peopleApi.peopleById<Person>(person.id, { method: 'PATCH', body: jsonBody(input) }),
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
            const latestPeople = await peopleApi.people<Person[]>({ readOnly: true });
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
    <PageHeader title="人员权限" actions={<Button variant="primary" className="primary-button" onClick={() => setCreating(true)}><UserPlus size={16} />{createPersonNeedsRecheck ? '核对新增人员' : '新增人员'}</Button>} />
    <div className="page-content accounts-page people-access-page">
      {!dataReady && loadError ? <EmptyState title="人员与权限加载失败" detail={loadError.message || '暂时无法读取人员与账号，请稍后重试。'} action={<Button variant="secondary" className="ghost-button" disabled={peopleQuery.isFetching || accountsQuery.isFetching} onClick={retry}>重新加载</Button>} />
        : !dataReady ? <LoadingState label="正在加载人员与权限…" className="stable-panel-state" /> : <>
      {loadError && <div className="warning-banner">数据刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={peopleQuery.isFetching || accountsQuery.isFetching} onClick={retry}>重新加载</Button></div>}
      {heldOrder && <div role="status" className="warning-banner">人员列表已变化，结束当前编辑后更新列表范围和顺序。</div>}
      {createPersonNeedsRecheck && <div role="alert" className="warning-banner">“{createPersonNeedsRecheck.input.name.trim()}”的新增人员结果待核对，原草稿已锁定。<Button variant="secondary" className="ghost-button" onClick={() => setCreating(true)}>继续核对</Button></div>}
      {openAccountNeedsRecheck && <div role="alert" className="warning-banner">“{openAccountNeedsRecheck.name}”的开通账号结果待核对，旧入口已锁定。<Button busy={(openAccountRechecking)} aria-label={openAccountRechecking ? "读取中…" : "重新读取账号"} variant="secondary" className="ghost-button" disabled={openAccountRechecking} onClick={() => void reloadOpenedAccount()}>{"重新读取账号"}</Button></div>}
      {resetNeedsRecheck && <div role="alert" className="warning-banner">“{resetNeedsRecheck.username}”的密码重置结果待核对，旧账号版本已锁定。<Button busy={(resetRechecking)} aria-label={resetRechecking ? "读取中…" : "重新读取账号"} variant="secondary" className="ghost-button" disabled={resetRechecking} onClick={() => void reloadResetAccount()}>{"重新读取账号"}</Button></div>}
      {removeAccountNeedsRecheck && <div role="alert" className="warning-banner">“{removeAccountNeedsRecheck.username}”的删除账号结果待核对，旧账号版本已锁定。<Button busy={(removeAccountRechecking)} aria-label={removeAccountRechecking ? "读取中…" : "重新读取账号"} variant="secondary" className="ghost-button" disabled={removeAccountRechecking} onClick={() => void reloadRemovedAccount()}>{"重新读取账号"}</Button></div>}
      {archivePersonNeedsRecheck && <div role="alert" className="warning-banner">“{archivePersonNeedsRecheck.name}”的人员归档结果待核对，旧人员版本已锁定。<Button busy={(archivePersonRechecking)} aria-label={archivePersonRechecking ? "读取中…" : "重新读取归档状态"} variant="secondary" className="ghost-button" disabled={archivePersonRechecking} onClick={() => void reloadArchivedPerson()}>{"重新读取归档状态"}</Button></div>}
      {accountStatusNeedsRecheck && <div role="alert" className="warning-banner">“{accountStatusNeedsRecheck.account.username}”的登录状态结果待核对，旧账号版本已锁定。<Button busy={(accountStatusRechecking)} aria-label={accountStatusRechecking ? "读取中…" : "重新读取登录状态"} variant="secondary" className="ghost-button" disabled={accountStatusRechecking} onClick={() => void reloadAccountStatus()}>{"重新读取登录状态"}</Button></div>}
      {accountProfileNeedsRecheck && <div role="alert" className="warning-banner">“{accountProfileNeedsRecheck.account.username}”的账号资料结果待核对，旧账号版本已锁定。<Button busy={(accountProfileRechecking)} aria-label={accountProfileRechecking ? "读取中…" : "重新读取账号资料"} variant="secondary" className="ghost-button" disabled={accountProfileRechecking} onClick={() => void reloadAccountProfile()}>{"重新读取账号资料"}</Button></div>}
      {personProfileNeedsRecheck && <div role="alert" className="warning-banner">“{personProfileNeedsRecheck.person.name}”的人员资料结果待核对，旧人员版本已锁定。<Button busy={(personProfileRechecking)} aria-label={personProfileRechecking ? "读取中…" : "重新读取人员资料"} variant="secondary" className="ghost-button" disabled={personProfileRechecking} onClick={() => void reloadPersonProfile()}>{"重新读取人员资料"}</Button></div>}
      <div className="filter-bar people-access-filters">
        <SearchInput value={keyword} onChange={setKeyword} placeholder="搜索姓名、岗位、登录名或拼音" />
        <select aria-label="按岗位筛选" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)}><option value="all">全部岗位</option>{jobTitle!=='all'&&!jobTitles.includes(jobTitle)&&<option value={jobTitle}>{jobTitle}</option>}{jobTitles.map((value) => <option key={value}>{value}</option>)}</select>
        <select aria-label="按平台权限筛选" value={role} onChange={(event) => setRole(event.target.value)}><option value="all">全部平台权限</option>{accountRoleOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>
        <select aria-label="按登录状态筛选" value={loginStatus} onChange={(event) => setLoginStatus(event.target.value)}><option value="all">全部登录状态</option><option value="active">允许登录</option><option value="disabled">禁止登录</option><option value="missing">未开通账号</option></select>
        <span>{displayedRows.length} 名人员</span>
      </div>
      <AdaptiveDataList label="人员与权限列表" className="account-data-list people-access-list paged-panel" bodyRef={pagination.scrollRef} footer={<Pagination {...pagination.props} label="人员与权限分页" />} columns={accountColumns} empty={!displayedRows.length && !peopleQuery.isLoading && !accountsQuery.isLoading && <EmptyState title="没有符合条件的人员" detail={rows.length ? '请调整搜索或筛选条件。' : '新增人员后会自动创建登录账号。'} />}>
        {pagination.items.map(({ person, account }) => {
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
      </AdaptiveDataList>
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
