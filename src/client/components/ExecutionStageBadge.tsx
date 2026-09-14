import { deriveExecutionStage, type ExecutionStage, type StageWork, type StageMilestone, workStageLabels, workStages, type WorkStage, milestoneKindLabels, milestoneKinds, type MilestoneKind } from '../../shared/execution-stage';
import './execution-stage.css';

export function executionStageOf(requirement: { status: string; executionStage?: ExecutionStage; stageResetAt?: string | null; workItems?: StageWork[]; milestones?: StageMilestone[] }) {
  return requirement.executionStage || deriveExecutionStage(requirement, requirement.workItems, requirement.milestones);
}
export function ExecutionStageBadge({ requirement, progress = true }: { requirement: Parameters<typeof executionStageOf>[0]; progress?: boolean }) {
  const stage = executionStageOf(requirement);
  return <span className="execution-stage-summary"><span className={'stage-badge stage-' + stage.tone} title={stage.currentWork.join('、')}>{stage.label}</span>{!stage.stages.length&&stage.currentWork.length>0&&<small>{stage.currentWork.join('、')}</small>}{progress && stage.stages.length === 1 && <small>{stage.stages[0].progress}%</small>}{progress && stage.stages.length > 1 && <small>{stage.stages.map(s => s.label + ' ' + s.progress + '%').join(' · ')}</small>}</span>;
}
export function WorkStageSelect({ value, onChange, disabled }: { value?: WorkStage | null; onChange: (stage: WorkStage | null) => void; disabled?: boolean }) {
  return <label className="field"><span>工作阶段</span><select aria-label="工作阶段" value={value || ''} disabled={disabled} onChange={e => onChange(e.target.value as WorkStage || null)}><option value="">未分类</option>{workStages.map(stage => <option key={stage} value={stage}>{workStageLabels[stage]}</option>)}</select></label>;
}
export function MilestoneKindSelect({ value, onChange }: { value?: MilestoneKind; onChange: (kind: MilestoneKind) => void }) {
  return <label className="field"><span>节点含义</span><select aria-label="节点含义" value={value || 'ordinary'} onChange={e => onChange(e.target.value as MilestoneKind)}>{milestoneKinds.map(kind => <option key={kind} value={kind}>{milestoneKindLabels[kind]}</option>)}</select></label>;
}
