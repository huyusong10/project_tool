import type { PhaseRequirement } from '../../shared/feature-phases';
import { useSession } from '../app-context';
import { formatDateTime } from '../format';
import { canManageProject } from '../permissions';
import { ButtonLink } from './Button';
import { DetailCard } from './DetailCard';
import { ExecutionStageBadge } from './ExecutionStageBadge';

type ArchivedFacts = Omit<PhaseRequirement, 'executionStage'> & Partial<Pick<PhaseRequirement, 'executionStage'>>;

/** Phase summaries retain these facts after a requirement leaves daily work. */
export function ArchivedRequirementDetails({ requirement, projectId }: { requirement: ArchivedFacts; projectId: string }) {
  const { session } = useSession();
  return <DetailCard title="归档需求" description="交付记录中保留此需求。" actions={<ExecutionStageBadge requirement={requirement} />}>
    <dl className="object-facts">
      <div><dt>归档时间</dt><dd>{formatDateTime(requirement.deletedAt)}</dd></div>
      <div><dt>记录完成度</dt><dd>{requirement.progress ?? (requirement.status === 'completed' ? 100 : 0)}%</dd></div>
      <div><dt>实际开始</dt><dd>{requirement.actualStart || '未记录'}</dd></div>
      {requirement.status === 'completed' && <div><dt>实际完成</dt><dd>{requirement.actualEnd || '未记录'}</dd></div>}
      <div className="object-fact-wide"><dt>完成标准</dt><dd>{requirement.acceptanceCriteria || '未填写'}</dd></div>
    </dl>
    {canManageProject(session, projectId) && <p><ButtonLink variant="secondary" to={'/project-settings?' + new URLSearchParams({ projectId })}>前往项目归档</ButtonLink></p>}
  </DetailCard>;
}
