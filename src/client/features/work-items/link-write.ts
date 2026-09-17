import { queryWriteResult, versionedWriteOutcome } from '../../core/write-recheck';
import { requirementsById } from '../requirements/api';
import { readReferenceLinks, type ReferenceLink } from '../../../shared/reference-links';
import type { Requirement } from '../../../shared/api/requirements';

export function inspectLinkWrite(requirementId: string, workItemId: string, request: {version: number; links: ReferenceLink[]} | null) {
  return queryWriteResult(request, async () => {
    const requirement = await requirementsById<Requirement>(requirementId, { readOnly: true });
    const work = requirement.workItems.find(item => item.id === workItemId);
    if (!work) throw Error('工作项已不存在，输入已保留。');
    return work;
  }, (original, latest) => original ? versionedWriteOutcome(original.version, latest.version,
    JSON.stringify(readReferenceLinks(latest.referenceLinks)) === JSON.stringify(original.links)) : 'not-applied');
}
