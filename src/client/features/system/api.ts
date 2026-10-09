import type { ApplicationMode, SystemBranding, SystemOverview, DatabaseIntegrityCheck, Backup } from '../../../shared/api/system';
import { api, InvalidResponseError, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export async function applicationMode(options: ApiRequestInit) {
  const result = await api<ApplicationMode>('/api/system/application-mode', options);
  if (typeof result?.issueTrackingOnly !== 'boolean' || !(result.updatedAt === null || typeof result.updatedAt === 'string' && Number.isFinite(Date.parse(result.updatedAt)))) {
    throw new InvalidResponseError(200, true, new Error('功能设置响应不完整'));
  }
  return result;
}

export function branding<T = SystemBranding>(options?: ApiRequestInit) {
  return api<T>(`/api/branding`, options);
}

export function systemBranding<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/system/branding`, options);
}

export function systemOverview<T = SystemOverview>(options?: ApiRequestInit) {
  return api<T>(`/api/system/overview`, options);
}

export function backups<T = Backup[]>(options?: ApiRequestInit) {
  return api<T>(`/api/backups`, options);
}

export function backupsDownloadQuery<T = unknown>(backupName: PathValue, filter: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/backups/${backupName}/download?expectedFingerprint=${filter}`, options);
}

export function backupsImportQuery<T = unknown>(filter: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/backups/import?filename=${filter}`, options);
}

export function backupsImportRestore<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/backups/import/restore`, options);
}

export function backupsRestore<T = unknown>(options?: ApiRequestInit) {
  return api<T>(`/api/backups/restore`, options);
}

export function backupsById<T = unknown>(backupName: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/backups/${backupName}`, options);
}

export function systemDatabaseCheck<T = DatabaseIntegrityCheck>(options?: ApiRequestInit) {
  return api<T>(`/api/system/database-check`, options);
}
