import { z } from 'zod';
import { workItemActualProgress, workItemProgressWeight, type WorkItemLike } from './domain';

export const workStages = ['analysis', 'development', 'integration', 'testing', 'other'] as const;
export type WorkStage = typeof workStages[number];
export const workStageInput = z.enum(workStages).nullable().optional();
export const workStageLabels: Record<WorkStage, string> = { analysis: '分析设计', development: '开发', integration: '联调', testing: '测试', other: '其他' };
export const milestoneKinds = ['ordinary', 'analysis_completed', 'design_completed', 'test_ready', 'test_submitted', 'test_passed'] as const;
export type MilestoneKind = typeof milestoneKinds[number];
export const milestoneKindInput = z.enum(milestoneKinds).optional();
export const milestoneKindLabels: Record<MilestoneKind, string> = { ordinary: '普通节点', analysis_completed: '分析完成', design_completed: '设计完成', test_ready: '提测就绪', test_submitted: '已提测', test_passed: '测试通过' };
export type ExecutionStage = {
  key: string; label: string; tone: string;
  stages: Array<{ stage: WorkStage; label: string; progress: number }>;
  currentWork: string[];
};
export type StageWork = WorkItemLike & { title?: string; workStage?: WorkStage | null };
export type StageMilestone = { milestoneKind?: MilestoneKind; title?: string; achievedAt?: string | null; achievedRecordedAt?: string | null; cancelled?: boolean | number };

/** Display only facts from the current execution round. It does not change completion rules. */
export function deriveExecutionStage(requirement: { status: string; stageResetAt?: string | null }, work: StageWork[] = [], milestones: StageMilestone[] = []): ExecutionStage {
  const result = (key: string, label: string, tone = key, stages: ExecutionStage['stages'] = [], currentWork: string[] = []): ExecutionStage => ({ key, label, tone, stages, currentWork });
  if (requirement.status === 'completed') return result('completed', '已完成');
  if (requirement.status === 'cancelled') return result('cancelled', '已取消');
  const effective = work.filter(w => w.status !== 'cancelled');
  const active = effective.filter(w => w.status === 'in_progress');
  const stages = workStages.filter(stage => stage !== 'other' && active.some(w => w.workStage === stage)).map(stage => {
    const items = effective.filter(w => w.workStage === stage), weight = items.reduce((n, w) => n + workItemProgressWeight(w), 0);
    return { stage, label: workStageLabels[stage], progress: Math.round(items.reduce((n, w) => n + workItemProgressWeight(w) * workItemActualProgress(w), 0) / weight) };
  });
  const achieved = milestones.filter(m => !m.cancelled && m.achievedAt && (!requirement.stageResetAt || (m.achievedRecordedAt || m.achievedAt) > requirement.stageResetAt))
    .sort((a, b) => (b.achievedRecordedAt || b.achievedAt || '').localeCompare(a.achievedRecordedAt || a.achievedAt || ''))[0];
  const currentWork = active.flatMap(w => w.title ? [w.title] : []);
  if (stages.length > 1) return result('parallel', stages.map(s => s.stage === 'testing' ? '部分测试' : s.label + '中').join(' · '), stages[0].stage, stages, currentWork);
  if(stages.length===1&&stages[0].stage!=='testing'&&achieved?.milestoneKind==='test_submitted')return result('parallel',stages[0].label+'中 · 部分已提测',stages[0].stage,stages,currentWork);
  if (stages.length === 1) return result(stages[0].stage, stages[0].label + '中', stages[0].stage, stages, currentWork);
  if (active.length) return result('in_progress', '进行中', 'not_started', [], currentWork);
  if (achieved) {
    const kind = achieved.milestoneKind || 'ordinary';
    return result(kind, kind === 'ordinary' ? achieved.title || '已达成节点' : milestoneKindLabels[kind], kind === 'test_submitted' || kind === 'test_ready' ? 'submitted' : kind === 'test_passed' ? 'testing' : 'analysis');
  }
  return result(requirement.status === 'not_started' ? 'not_started' : 'in_progress', requirement.status === 'not_started' ? '未开始' : '进行中', 'not_started');
}
