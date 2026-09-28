import { describe, expect, it } from 'vitest';
import { ApiError, InvalidResponseError, NetworkError } from '../src/client/api';
import { connectionFeedback } from '../src/client/features/jira/connection-feedback';
import { jiraConnectionMessages, jiraSetupMessages } from '../src/shared/jira';

describe('personal Jira connection feedback', () => {
  it.each([
    ['JIRA_KEY_UNAVAILABLE', jiraSetupMessages.deployment],
    ['JIRA_DISABLED', jiraSetupMessages.disabled],
    ['JIRA_AUTH_FAILED', jiraConnectionMessages.invalidToken],
    ['JIRA_PERMISSION_DENIED', jiraConnectionMessages.permission],
    ['JIRA_CONNECTION_FAILED', jiraConnectionMessages.unavailable],
  ])('explains %s without displaying raw details', (code, message) => {
    expect(connectionFeedback(new ApiError('internal details and secrets', 502, code), 'save')).toBe(message);
  });
  it('never displays an unexpected backend message', () => {
    expect(connectionFeedback(new Error('SQLITE_ERROR confidential'), 'save')).not.toContain('SQLITE');
    expect(connectionFeedback(new ApiError('private backend error', 500))).toBe('暂时无法读取 Jira 连接，请稍后重试。');
  });
  it('asks to check uncertain save or removal results instead of claiming failure', () => {
    for (const error of [new NetworkError(true, new Error('secret')), new InvalidResponseError(200, true, new Error('secret'))]) {
      expect(connectionFeedback(error, 'save')).toContain('不要重复提交');
      expect(connectionFeedback(error, 'remove')).not.toContain('secret');
    }
  });
});
