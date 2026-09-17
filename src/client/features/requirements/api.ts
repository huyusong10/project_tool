import type { Requirement, PlanPreview, CreateRequirementInput } from '../../../shared/api/requirements';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function createRequirement(input: CreateRequirementInput) {
  return requirements<Requirement>({ method: 'POST', body: JSON.stringify(input) });
}

export function requirementsForProject<T = Requirement[]>(projectId: string, options?: ApiRequestInit) {
  return api<T>(`/api/requirements${projectId ? `?projectId=${projectId}` : ''}`, options);
}

export function requirementsById<T = Requirement>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}`, options);
}

export function requirementsById2<T = unknown>(requirementId: PathValue, action: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/${action}`, options);
}

export function requirements<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/requirements`, options);
}

export function requirementsQuery<T = Requirement[]>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements?projectId=${projectId}`, options);
}

export function requirementsProgress<T = unknown>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/progress`, options);
}

export function requirementsByIdQuery<T = Requirement>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}?includeDeleted=true`, options);
}

export function requirementsResourceById<T = unknown>(requirementId: PathValue, suffix: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}${suffix}`, options);
}

export function requirementsCorrect<T = unknown>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/correct`, options);
}

export function requirementsPlanPreview<T = PlanPreview>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/plan-preview`, options);
}

export function requirementsApplyPlan<T = unknown>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/apply-plan`, options);
}

export function requirementsReorderWorkItems<T = unknown>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/reorder-work-items`, options);
}

export function requirementsWorkItems<T = unknown>(requirementId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/requirements/${requirementId}/work-items`, options);
}
