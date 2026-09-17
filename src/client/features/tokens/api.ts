import type { ApiToken } from '../../../shared/api/tokens';
import { api, type ApiRequestInit } from '../../api';

type PathValue = string | number | URLSearchParams;

export function tokens<T = ApiToken[]>(options?: ApiRequestInit) {
  return api<T>(`/api/tokens`, options);
}

export function tokensById<T = unknown>(tokenId: PathValue, options?: ApiRequestInit) {
  return api<T>(`/api/tokens/${tokenId}`, options);
}
