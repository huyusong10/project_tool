import type { JiraStatus } from '../../shared/jira';
import type { JiraWorkflow, PrSource, PrWork } from '../../shared/jira-pr';
import { businessDateFromDateTime, requirementStatusLabels } from '../../shared/domain';
import { workStageLabels, type WorkStage } from '../../shared/execution-stage';
import { getRequirement } from './requirements';
import { newPrStep } from './jira-pr-store';

const stock: Record<string, string[]> = {
  start: ['开始工作项', '开始需求'], complete: ['完成工作项', '完成需求', '工作完成'],
  cancel: ['取消工作项', '取消需求'], reopen: ['重新打开工作项'],
};
const statusLabels: Record<string, string> = { ...requirementStatusLabels, blocked: '受阻', pending_acceptance: '待验收' };
const day = (value: string) => businessDateFromDateTime(value);

function isAutomaticNote(source: PrSource) {
  if (source.supersedesId) return false;
  if (stock[source.eventType]?.includes(source.content)) return true;
  // Match only the exact progress fallback emitted by the local command. Unknown text stays intact.
  const match = source.eventType === 'progress' && /^完成度：(\d+)% → (\d+)%$/.exec(source.content);
  return !!match && Number(match[1]) <= 100 && Number(match[2]) === (source.workItemId ? source.workItemPercent : source.percent);
}

function progressSummary(work: PrWork[], sources: PrSource[], collectedAt: string) {
  const selected = work.filter(w => sources.some(s => s.workItemId === w.id && s.eventType !== 'note'));
  const groups = new Map<string, { date: string; status: string; titles: string[] }>();
  const included = new Set<string | null>();
  for (const w of selected) {
    if (included.has(w.id)) continue;
    const stageWork = w.stage && w.stage !== 'other' ? work.filter(other => other.stage === w.stage) : [];
    const wholeStage = !!workStageLabels[w.stage as WorkStage] && stageWork.length > 0
      && stageWork.every(other => other.status === 'completed' && selected.includes(other));
    const items = wholeStage ? stageWork : [w];
    items.forEach(item => included.add(item.id));
    const title = wholeStage ? workStageLabels[w.stage as WorkStage] : w.id === null ? '需求' : w.title;
    const date = w.status === 'completed' && items.every(item => item.actualEnd && item.actualEnd <= day(collectedAt))
      ? items.map(item => item.actualEnd!).sort().at(-1)! : '';
    const status = statusLabels[w.status] || '状态待确认';
    const key = date + ':' + status;
    const group = groups.get(key) || { date, status, titles: [] };
    group.titles.push(title); groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
    .map(g => `${g.date ? g.date + ' ' : ''}${g.titles.join('、')}${g.status}`).join('；');
}

export function capturePrWork(requirementId: string): PrWork[] {
  const r = getRequirement(requirementId, true, false);
  return r.executionMode === 'direct'
    ? [{ id: null, title: r.title, stage: null, status: r.status, progress: r.progress, actualStart: r.actualStart || null, actualEnd: r.actualEnd || null }]
    : (r.workItems || []).map(w => ({ id: w.id, title: w.title, stage: w.workStage || null, status: w.status, progress: w.progress, actualStart: w.actualStart, actualEnd: w.actualEnd }));
}

export function summarizePrComment(work: PrWork[], sources: PrSource[], allSources: PrSource[], collectedAt: string, target?: JiraStatus | null, basis = '') {
  const sorted = [...new Map(sources.map(s => [s.id, s])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lines: string[] = [];
  const summary = progressSummary(work, sorted, collectedAt);
  if (summary) lines.push('进展摘要', summary + '。');
  const notes = sorted.filter(s => s.content.trim() && !isAutomaticNote(s));
  if (notes.length) {
    lines.push(...(lines.length ? [''] : []), '人员评论');
    for (const source of notes) {
      const original = source.supersedesId && allSources.find(s => s.id === source.supersedesId);
      const correction = source.supersedesId ? `（修正${original ? ' ' + day(original.createdAt) + ' ' : '原'}记录）` : '';
      lines.push('', `${day(source.createdAt)} · ${source.workItemTitle || '需求'}${source.createdByName ? ' · ' + source.createdByName : ''}${correction}`, source.content);
    }
  }
  if (!lines.length) {
    if (basis) lines.push(basis);
    if (target) lines.push(`拟将 Jira 状态更新为${target.name}。`);
  }
  return lines.join('\n');
}

export function draftRouteComments(work: PrWork[], sources: PrSource[], allSources: PrSource[], collectedAt: string, basis: string, path: JiraWorkflow['edges']) {
  const groups = path.map(() => [] as PrSource[]);
  // Assign only explicit phase matches; all other evidence appears once in the first comment.
  const phases: Record<string, string[]> = { analysis: ['设计', '分析设计'], development: ['开发'], integration: ['开发', '联调'], testing: ['测试'] };
  for (const source of new Map(sources.map(s => [s.id, s])).values()) {
    const stage = work.find(w => w.id === source.workItemId)?.stage;
    const matches = stage ? path.map((edge, index) => phases[stage]?.includes(edge.from.name.trim()) ? index : -1).filter(i => i >= 0) : [];
    groups[matches.length === 1 ? matches[0] : 0]?.push(source);
  }
  return path.map((edge, index) => ({ ...newPrStep(summarizePrComment(work, groups[index], allSources, collectedAt, edge.to, basis), groups[index].map(s => s.id)), kind: 'transition' as const, target: edge.to, transitionId: edge.id, transitionName: edge.name }));
}
