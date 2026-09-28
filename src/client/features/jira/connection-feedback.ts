import { AccessChangedError, ApiError, InvalidResponseError, NetworkError } from '../../api';
import { jiraConnectionMessages, jiraSetupMessages } from '../../../shared/jira';

export function connectionFeedback(error: unknown, action: 'read' | 'save' | 'test' | 'remove' = 'read'): string | null {
  if (!error) return null;
  if (error instanceof AccessChangedError) return '登录状态已变化，请重新登录后再设置 Jira 连接。';
  if (error instanceof NetworkError || error instanceof InvalidResponseError) return error.outcomeUnknown
    ? '暂时无法确认操作是否成功。请先重新读取连接，核对保存状态，不要重复提交。'
    : '暂时无法读取连接信息，请检查网络后重试。';
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'JIRA_KEY_UNAVAILABLE': return jiraSetupMessages.deployment;
      case 'JIRA_DISABLED': return jiraSetupMessages.disabled;
      case 'JIRA_AUTH_FAILED': return jiraConnectionMessages.invalidToken;
      case 'JIRA_PERMISSION_DENIED': return jiraConnectionMessages.permission;
      case 'JIRA_CONNECTION_FAILED': return jiraConnectionMessages.unavailable;
      case 'JIRA_CONNECTION_REQUIRED': return '已保存的连接暂时不可用，请重新读取连接后核对。';
      case 'STALE_WRITE': return '连接信息已变化，请重新读取后再操作。';
      case 'VALIDATION_ERROR': return 'Token 格式不正确，请检查是否完整，以及中间是否包含空格或换行。';
    }
    if (error.status === 401) return '登录已过期，请重新登录后再设置 Jira 连接。';
    if (error.status === 403) return '当前账号无权执行此操作，请联系系统管理员。';
  }
  return action === 'read' ? '暂时无法读取 Jira 连接，请稍后重试。' : action === 'test' ? jiraConnectionMessages.unavailable : '暂时无法更新 Jira 连接，请重新读取连接，核对保存状态后再试。';
}
