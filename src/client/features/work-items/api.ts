import type { WorkItem } from '../../../shared/api/work-items';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function workItemsById<T = WorkItem>(workItemId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/work-items/${workItemId}`, options);
}

export function workItemsById2<T = unknown>(workItemId: PathValue, action: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/work-items/${workItemId}/${action}`, options);
}

export function workItemsResourceById<T = unknown>(workItemId: PathValue, suffix: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/work-items/${workItemId}${suffix}`, options);
}

export function workItemWriteUrl(id: string, correction: boolean) { return `/api/work-items/${id}${correction ? '/correct' : ''}`; }
