import type { Session, Account } from '../../../shared/api/accounts';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function session<T = Session>(options?: ApiRequestInit) {
  return api<T>(`/api/session`, options);
}

export function login<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/login`, options);
}

export function accountChangePassword<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/account/change-password`, options);
}

export function logout<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/logout`, options);
}

export function accounts<T = Account[]>(options?: ApiRequestInit) {
  return api<T>(`/api/accounts`, options);
}

export function accountsResetPassword<T = unknown>(accountId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/accounts/${accountId}/reset-password`, options);
}

export function accountsById<T = Account>(accountId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/accounts/${accountId}`, options);
}
