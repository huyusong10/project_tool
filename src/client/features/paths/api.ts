import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function workItemsPathEstimate<T = unknown>(workItemId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/work-items/${workItemId}/path-estimate`, options);
}

export function projectsPathAnalysisQuery<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/path-analysis?target=project`, options);
}

export function requirementsDependencyPlanPreview<T = unknown>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/dependency-plan/preview`, options);
}

export function projectsPathGraphQuery<T = unknown>(projectId: PathValue, query: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/path-graph?${query}`, options);
}

export function milestonesById<T = unknown>(action: PathValue, value1: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/milestones/${action}/${value1}`, options);
}

export function projectsDependencyChangesById<T = unknown>(projectId: PathValue, batchId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/dependency-changes/${batchId}`, options);
}

export function projectsDependencyChangesApply<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/dependency-changes/apply`, options);
}

export function projectsDependencyChangesPreview<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/dependency-changes/preview`, options);
}

export function saveDependency(projectId: string, options: ApiRequestInit) { return api(`/api/projects/${projectId}/dependencies`, options); }
export function saveEstimate(workItemId: string, options: ApiRequestInit) { return api(`/api/work-items/${workItemId}/path-estimate`, options); }
export function applyDependencyPlan(requirementId: string, options: ApiRequestInit) { return api(`/api/requirements/${requirementId}/dependency-plan/apply`, options); }
