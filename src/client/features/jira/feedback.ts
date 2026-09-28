import { ApiError, InvalidResponseError, NetworkError } from '../../api';
import { connectionFeedback } from './connection-feedback';

export function jiraFeedback(error: unknown): string {
  if (!error) return '';
  if (error instanceof NetworkError || error instanceof InvalidResponseError) return '暂时未能取得操作结果，请重新读取；不要重复提交修改。';
  if (error instanceof ApiError) {
    if (['STALE_WRITE', 'DEPENDENCY_CONFLICT', 'VALIDATION_ERROR', 'FORBIDDEN', 'NOT_FOUND', 'JIRA_CONNECTION_REQUIRED'].includes(error.code || '')) return error.message;
    return connectionFeedback(error) || '操作未完成，请稍后重试。';
  }
  return '操作未完成，请检查填写内容或稍后重试。';
}
