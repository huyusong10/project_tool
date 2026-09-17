import type { Person } from '../../../shared/api/people';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function peopleQuery<T = Person[]>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/people?projectId=${projectId}`, options);
}

export function people<T = Person[]>(options?: ApiRequestInit) {
  return api<T>(`/api/people`, options);
}

export function peopleAccount<T = unknown>(personId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/people/${personId}/account`, options);
}

export function peopleById<T = Person>(personId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/people/${personId}`, options);
}

export function peopleCandidatesQuery<T = Person[]>(projectId: PathValue, suffix: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/people/candidates?projectId=${projectId}${suffix}`, options);
}
