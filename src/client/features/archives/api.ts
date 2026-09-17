import type { Archives } from '../../../shared/api/archives';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function archives<T = Archives>(options?: ApiRequestInit) {
  return api<T>(`/api/archives`, options);
}

export function ResourceRestore<T = unknown>(action: PathValue, value1: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/${action}/${value1}/restore`, options);
}

export function archivesById<T = unknown>(action: PathValue, value1: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/archives/${action}/${value1}`, options);
}

export function archivesQuery<T = Archives>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/archives?projectId=${projectId}`, options);
}
