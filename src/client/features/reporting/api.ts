import type { Dashboard, MyWork, PeopleConcurrency } from '../../../shared/api/reporting';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function analyticsPeopleConcurrencyQuery<T = PeopleConcurrency>(query: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/analytics/people-concurrency?${query}`, options);
}

export function dashboardQuery<T = Dashboard>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/dashboard?projectId=${projectId}`, options);
}

export function analyticsQuery<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/analytics/query`, options);
}

export function analyticsCatalog<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/analytics/catalog`, options);
}

export function analyticsLayout<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/analytics/layout`, options);
}

export function myWork<T = MyWork>(options?: ApiRequestInit) {
  return api<T>(`/api/my-work`, options);
}

export function searchActionItems<T = unknown>(query: URLSearchParams, options?: ApiRequestInit) {
  return api<T>(`/api/action-items?${query}`, options);
}
