import type { AuditPage } from '../../../shared/api/audit';
import { api, type ApiRequestInit } from '../../api';

export function searchAudit<T = AuditPage>(query: URLSearchParams, options?: ApiRequestInit) {
  return api<T>(`/api/audit/search?${query}`, options);
}
