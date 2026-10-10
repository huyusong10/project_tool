import { describe, expect, it } from 'vitest';
import { jiraKeyFromUrl, jiraKeysFromTitle, jiraReferenceEntries, normalizedJiraTitle } from '../src/shared/jira-links';

describe('Jira reference recognition', () => {
  it('builds unique entries from explicit same-site links and preserves the Jira context path', () => {
    expect(jiraReferenceEntries([
      { url: 'https://jira.test/jira/browse/dcim-33?focusedCommentId=5' },
      { url: 'https://jira.test/jira/issues/?selectedIssue=DCIM-33' },
      { url: 'https://jira.test/jira/browse/DCIM-34' },
      { url: 'https://other.test/browse/DCIM-35' },
    ], 'https://jira.test/jira/')).toEqual([
      { key: 'DCIM-33', url: 'https://jira.test/jira/browse/DCIM-33', source: 'reference' },
      { key: 'DCIM-34', url: 'https://jira.test/jira/browse/DCIM-34', source: 'reference' },
    ]);
    for (const site of ['file://jira.test', 'https://user:password@jira.test', 'invalid']) {
      expect(jiraReferenceEntries([{ url: site + '/browse/DCIM-33' }], site)).toEqual([]);
    }
  });
  it.each([
    '/browse/dcim-33?focusedCommentId=5#comment-5',
    '/projects/DCIM/issues/DCIM-33?filter=allopenissues',
    '/secure/RapidBoard.jspa?rapidView=1&selectedIssue=DCIM-33',
    '/issues/?selectedIssue=DCIM-33',
    '/browse/DCIM%2D33/',
  ])('normalizes %s', path => {
    expect(jiraKeyFromUrl('https://jira.test' + path, 'https://jira.test')).toBe('DCIM-33');
    expect(jiraKeyFromUrl('https://jira.test/jira' + path, 'https://jira.test/jira/')).toBe('DCIM-33');
  });
  it.each([
    'https://other.test/browse/DCIM-33', 'https://jira.test.evil.test/browse/DCIM-33',
    'https://person@jira.test/browse/DCIM-33', 'https://jira.test/browse/DCIM-33/other',
    'https://jira.test/browse/DCIM-33?selectedIssue=DCIM-34',
    'https://jira.test/issues/?selectedIssue=DCIM-33&selectedIssue=DCIM-34',
    'https://jira.test/issues/?jql=key%3DDCIM-33', 'invalid',
  ])('rejects ambiguous or foreign URL %s', url => expect(jiraKeyFromUrl(url, 'https://jira.test')).toBeNull());
  it('uses only a configured context path', () => expect(jiraKeyFromUrl('https://jira.test/browse/DCIM-33', 'https://jira.test/jira')).toBeNull());
  it('recognizes title hints without interpreting arbitrary partial keys', () => {
    expect(jiraKeysFromTitle('【DCIM-33】 用户管理 dcim-33 / DCIM-34')).toEqual(['DCIM-33', 'DCIM-34']);
    expect(jiraKeysFromTitle('PREFIX-DCIM-33suffix')).toEqual([]);
    expect(normalizedJiraTitle('DCIM-33 【权限管理】用户管理')).toBe(normalizedJiraTitle('用户管理'));
  });
});
