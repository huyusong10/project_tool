import type { WorkItemTemplate } from '../../../shared/api/templates';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function templatesQuery<T = WorkItemTemplate[]>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/templates?projectId=${projectId}`, options);
}

export function templatesById<T = WorkItemTemplate>(templateId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/templates/${templateId}`, options);
}

export function templates<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/templates`, options);
}
