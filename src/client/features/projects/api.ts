import type { Project } from '../../../shared/api/projects';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function projects<T = Project[]>(options?: ApiRequestInit) {
  return api<T>(`/api/projects`, options);
}

export function projectsById<T = Project>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}`, options);
}

export function projectsRequirementsTestSubmission<T = unknown>(projectId: PathValue, requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/requirements/${requirementId}/test-submission`, options);
}

export function projectsResourceById<T = unknown>(projectId: PathValue, suffix: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}${suffix}`, options);
}

export function projectsMembers<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/members`, options);
}

export function projectsMembersById<T = unknown>(projectId: PathValue, personId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/members/${personId}`, options);
}

export function projectsChangeVersion<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/change-version`, options);
}
