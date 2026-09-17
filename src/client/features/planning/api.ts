import { api, InvalidResponseError, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export async function projectsPathGraphQuery<T = {analysis: import('../../../shared/paths').PathAnalysis}>(projectId: PathValue, options?: ApiRequestInit) {
  const result = await api<T>(`/api/projects/${projectId}/path-graph?view=features`, options);
  const analysis = (result as {analysis?: Partial<import('../../../shared/paths').PathAnalysis>} | null)?.analysis;
  if (!analysis || typeof analysis.projectId !== 'string' || !Array.isArray(analysis.nodes) || !Array.isArray(analysis.requirements)) {
    throw new InvalidResponseError(200, false, '工作区图数据不完整');
  }
  return result;
}

export function projectsFeatureOverviewQuery<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/feature-overview?state=all`, options);
}

export function projectsFeaturesQuery<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/features?state=all`, options);
}

export function projectsFeaturesResourceById<T = unknown>(projectId: PathValue, suffix: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/features${suffix}`, options);
}

export function projectsFeaturesRequirementsQuery<T = unknown>(projectId: PathValue, featureId: PathValue, query: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/features/${featureId}/requirements?${query}`, options);
}

export function projectsFeaturePhasesQuery<T = unknown>(projectId: PathValue, featureId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/feature-phases?featureId=${featureId}`, options);
}

export function projectsRequirementPlacement<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/requirement-placement`, options);
}

export function projectsRequirementImportPreview<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/requirement-import/preview`, options);
}

export function projectsRequirementImportApply<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/requirement-import/apply`, options);
}

export function projectsRequirementImportReceiptsById<T = unknown>(projectId: PathValue, batchId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/requirement-import/receipts/${batchId}`, options);
}

export function projectsRequirementIntake<T = unknown>(projectId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/projects/${projectId}/requirement-intake`, options);
}

export function savePhase(projectId: string, featureId: string, input: unknown) {
  return api<import('../../../shared/feature-phases').FeaturePhase>(`/api/projects/${projectId}/features/${featureId}/phases`, { method: 'POST', body: JSON.stringify(input) });
}
export function deletePhase(projectId: string, phaseId: string, input: unknown) {
  return api<{id: string; deleted: boolean}>(`/api/projects/${projectId}/feature-phases/${phaseId}`, { method: 'DELETE', body: JSON.stringify(input) });
}
