import { getDatabaseContext } from '../database-context';
import { fail } from '../errors';

export function assertJiraWriteUnlocked(issueId: string, site: string, operationId = '', prId = '') {
  const db = getDatabaseContext().sqlite;
  const old = db.prepare(`SELECT 1 FROM jira_operations o,json_each(o.payload,'$.items') i
    WHERE o.kind IN ('sync','transition') AND o.id<>? AND json_extract(i.value,'$.issueId')=? AND json_extract(i.value,'$.site')=?
    AND (o.state='running' OR json_extract(i.value,'$.outcome')='unknown') LIMIT 1`).get(operationId, issueId, site);
  const pr = db.prepare(`SELECT 1 FROM jira_prs p,json_each(p.payload,'$.items') i,json_each(i.value,'$.steps') s
    WHERE p.id<>? AND json_extract(i.value,'$.issueId')=? AND json_extract(i.value,'$.site')=?
    AND (p.state='running' OR json_extract(s.value,'$.comment.state') IN ('unknown','running') OR json_extract(s.value,'$.transition.state') IN ('unknown','running')) LIMIT 1`).get(prId, issueId, site);
  if (old || pr) fail('此 Jira 事项有执行中或待核对的操作，请先处理原操作记录', 'DEPENDENCY_CONFLICT', 409);
}
