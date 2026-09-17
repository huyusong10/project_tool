import type { Issue, IssuePage } from '../../../shared/api/issues';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function issuesById<T = Issue>(issueId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/issues/${issueId}`, options);
}

export function issues<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/issues`, options);
}

export function issuesQuery<T = IssuePage>(query: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/issues?${query}`, options);
}

export function issuesById2<T = unknown>(issueId: PathValue, action: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/issues/${issueId}/${action}`, options);
}

export function issuesCorrect<T = unknown>(issueId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/issues/${issueId}/correct`, options);
}

export function searchIssues<T = IssuePage>(query: URLSearchParams, options?: ApiRequestInit) {
  return api<T>(`/api/issues?${query}`, options);
}
