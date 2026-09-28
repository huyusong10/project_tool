import type { JiraMetadataQuery } from '../../shared/jira';
import type { Actor } from '../auth';
import { fail } from '../errors';
import { jiraSession } from './jira-connection';
import { assertJiraProject } from './jira-scan';

export async function readJiraMetadata(projectId: string, actor: Actor, query: JiraMetadataQuery) {
  assertJiraProject(projectId, actor);
  const session = jiraSession(actor);
  if (session.version !== query.version) fail('个人连接已变化，请重新读取连接', 'STALE_WRITE', 409);
  const result = await (() => {
    switch (query.kind) {
      case 'projects': return session.client.projects();
      case 'types': return session.client.issueTypes(query.project);
      case 'components': return session.client.components(query.project);
      case 'users': return session.client.users(query.query);
      case 'labels': return session.client.labels(query.query);
    }
  })();
  session.assertCurrent();
  assertJiraProject(projectId, actor);
  return result;
}
