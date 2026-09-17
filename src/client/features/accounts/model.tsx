import { usePersistedRecheck } from "../../core/use-persisted-recheck";

import type { Account, Person } from "../../types";
import { type AdaptiveDataColumn } from "../../components/AdaptiveDataList";

export type OpenAccountResult = { account: Account; temporaryPassword: string };

export type IdentityRow = { person: Person; account: Account | null };

export type AccessConfirmation =
  | { kind: 'reset'; account: Account }
  | { kind: 'delete'; account: Account }
  | { kind: 'toggle'; account: Account; nextStatus: Account['status'] }
  | { kind: 'archive'; person: Person; account: Account | null };

export type AccessResult = { title: string; message: string; value?: string; error?: boolean };

export type AccountStatusRecheck = { account: Account; nextStatus: Account['status'] };

export type AccountProfileRecheck = { account: Account; username?: string; role?: Account['globalRole'] };

export type PersonProfileRecheck = { person: Person; name?: string; jobTitle?: string | null; hasJobTitle: boolean };

export type CreatePersonInput = { name: string; jobTitle: string };

export type CreatePersonRecheck = { input: CreatePersonInput; initialPersonIds: string[] | null };

export type AccessRecheckKind = 'create-person' | 'open' | 'reset' | 'remove' | 'archive' | 'status' | 'account-profile' | 'person-profile';

export const emptyPeople: Person[] = [];

export const emptyAccounts: Account[] = [];

export const errorMessage = (error: unknown) => error instanceof Error ? error.message : undefined;

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isStoredAccount = (value: unknown): value is Account => isRecord(value)
  && typeof value.id === 'string' && typeof value.username === 'string' && typeof value.updatedAt === 'string';

export const isStoredPerson = (value: unknown): value is Person => isRecord(value)
  && typeof value.id === 'string' && typeof value.name === 'string' && typeof value.updatedAt === 'string';

export const isStoredAccountStatus = (value: unknown): value is AccountStatusRecheck => isRecord(value)
  && isStoredAccount(value.account) && (value.nextStatus === 'active' || value.nextStatus === 'disabled');

export const isStoredAccountProfile = (value: unknown): value is AccountProfileRecheck => isRecord(value)
  && isStoredAccount(value.account)
  && (value.username === undefined || typeof value.username === 'string')
  && (value.role === undefined || value.role === 'user' || value.role === 'admin');

export const isStoredPersonProfile = (value: unknown): value is PersonProfileRecheck => isRecord(value)
  && isStoredPerson(value.person)
  && (value.name === undefined || typeof value.name === 'string')
  && (value.jobTitle === undefined || value.jobTitle === null || typeof value.jobTitle === 'string')
  && typeof value.hasJobTitle === 'boolean';

export const isStoredCreatePerson = (value: unknown): value is CreatePersonRecheck => isRecord(value)
  && isRecord(value.input)
  && typeof value.input.name === 'string'
  && typeof value.input.jobTitle === 'string'
  && (value.initialPersonIds === null || Array.isArray(value.initialPersonIds) && value.initialPersonIds.every((id) => typeof id === 'string'));

export function useAccessRecheck<T>(accountKey: string, kind: AccessRecheckKind, validate: (value: unknown) => value is T) {
  return usePersistedRecheck(`project-manage:access-recheck:${accountKey}:${kind}`, validate);
}

export function assignmentKey(account: Account) {
  const { requirements, workItems, issues } = account.activeAssignments;
  return `${requirements}:${workItems}:${issues}`;
}

export function personAccessKey(account: Account | null | undefined) {
  if (!account) return 'none';
  return JSON.stringify([
    account.id,
    account.updatedAt,
    assignmentKey(account),
    account.managedProjects.map(({ id }) => id).sort(),
  ]);
}

export const accountColumns: AdaptiveDataColumn[] = [
  { key: 'identity', label: '人员与岗位', track: 'minmax(210px,1.25fr)', importance: 'primary', compact: 'primary' },
  { key: 'account', label: '登录账号', track: 'minmax(160px,.85fr)', compact: 'full' },
  { key: 'permission', label: '平台权限', track: 'minmax(210px,1.05fr)', compact: 'full' },
  { key: 'status', label: '登录状态', track: 'minmax(140px,.65fr)', compact: 'detail' },
  { key: 'login', label: '最近登录', track: 'minmax(150px,.7fr)', compact: 'full' },
  { key: 'actions', label: '操作', track: '64px', compact: 'actions', align: 'center' },
];
