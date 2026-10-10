import type { AuditLog } from '../../types';
import { workspaceParams } from '../../workspace-location';
import { featureAssessmentLabels } from '../../../shared/intake';

function snapshot(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Some services wrap their JSON snapshots in a fixed text envelope. Unknown formats remain intact. */
function textSnapshotSummary(summary: string): string | undefined {
  const legacyImport=summary.match(/^导入需求：(\d+) 个新需求$/);
  if(legacyImport)return `导入需求：新增 ${legacyImport[1]} 个；更新数量未记录`;
  const placement=summary.match(/^导入调整归属：(\{[\s\S]*\})$/);
  if(placement){
    try{
      const value=snapshot(JSON.parse(placement[1])),before=snapshot(value?.before),after=snapshot(value?.after);
      if(!value||!before||!after||Object.keys(value).some(key=>!['title','before','after','reason'].includes(key)))return;
      if(['title','reason'].some(key=>value[key]!==undefined&&typeof value[key]!=='string'))return;
      for(const side of [before,after]){
        if(Object.keys(side).some(key=>!['featureId','phaseId','featureName','phaseName'].includes(key)))return;
        if(['featureId','phaseId'].some(key=>side[key]!==null&&typeof side[key]!=='string'))return;
        if(['featureName','phaseName'].some(key=>side[key]!==undefined&&side[key]!==null&&typeof side[key]!=='string'))return;
      }
      const changes:string[]=[];
      for(const [key,name,label] of [['featureId','featureName','所属特性'],['phaseId','phaseName','所属Phase']]){
        if(before[key]===after[key])continue;
        const describe=(side:Record<string,unknown>)=>side[key]===null?'未设置':typeof side[name]==='string'&&side[name].trim()?side[name]:undefined;
        const previous=describe(before),current=describe(after);
        changes.push(previous!==undefined&&current!==undefined?`${label}：${previous} → ${current}`:`${label}已调整`);
      }
      if(!changes.length)return;
      if(typeof value.reason==='string'&&value.reason.trim())changes.push('安排原因：'+value.reason.trim());
      return ['导入调整归属'+(typeof value.title==='string'&&value.title.trim()?'：'+value.title:''),...changes].join('；');
    }catch{return;}
  }
  const creation = summary.match(/^(创建需求(?:并生成工作项)?：[\s\S]+?)；(\{[\s\S]*\})$/);
  if (creation) {
    try {
      const organization = snapshot(JSON.parse(creation[2]));
      if (typeof organization?.reason === 'string' && organization.reason.trim()
        && Object.keys(organization).every(key => ['featureId', 'phaseId', 'reason'].includes(key))) {
        return `${creation[1]}；安排原因：${organization.reason.trim()}`;
      }
    } catch { /* Unrecognized records keep their original text. */ }
    return;
  }
  const match = summary.match(/^(修改特性|规划关系|移除规划关系|调整特性归属)；修改前：([\s\S]+?)；修改后：([\s\S]+?)(?:；原因：([\s\S]*))?$/);
  if (!match) return;
  try {
    const beforeValue: unknown = JSON.parse(match[2]), afterValue: unknown = JSON.parse(match[3]);
    const before = snapshot(beforeValue), after = snapshot(afterValue);
    if ((!before && beforeValue !== null) || (!after && afterValue !== null) || (!before && !after)) return;
    const title = after?.name || after?.title || before?.name || before?.title;
    const changes: string[] = [];
    const textChange = (label: string, previous: unknown, current: unknown) => {
      if (typeof current !== 'string' || current === previous || (previous !== undefined && typeof previous !== 'string')) return;
      if (before) changes.push(`${label}：${previous || '未填写'} → ${current || '未填写'}`);
      else if (current) changes.push(`${label}：${current}`);
    };
    if (before && after) textChange('名称', before.name, after.name);
    textChange('说明', before?.description, after?.description);
    textChange('关系说明', before?.note, after?.note);
    if (!after && typeof before?.note === 'string' && before.note) changes.push(`原关系说明：${before.note}`);
    const previousOverview = snapshot(before?.overview), currentOverview = snapshot(after?.overview);
    const assessment = (value: unknown) => typeof value === 'string' && Object.hasOwn(featureAssessmentLabels, value)
      ? featureAssessmentLabels[value as keyof typeof featureAssessmentLabels] : value;
    textChange('判断', assessment(previousOverview?.assessment), assessment(currentOverview?.assessment));
    for (const [key, label] of [['expectation', '大致预期'], ['progressSummary', '进展简述'], ['note', '原因或变化说明']]) {
      textChange(label, previousOverview?.[key], currentOverview?.[key]);
    }
    if (before && after) {
      for (const [key, label] of [['featureId', '所属特性'], ['phaseId', '所属Phase'], ['sourceFeatureId', '前置特性'], ['targetFeatureId', '后续特性'], ['sortOrder', '同级顺序'], ['referenceLinks', '关联链接']]) {
        if (Object.hasOwn(after, key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])) changes.push(`${label}已调整`);
      }
      if (Boolean(before.archivedAt) !== Boolean(after.archivedAt)) changes.push(after.archivedAt ? '特性已归档' : '特性已恢复');
    }
    if (match[4]?.trim()) changes.push(match[4].trim());
    const action = match[1] === '修改特性' ? !before ? '创建特性' : !after ? '删除特性' : '修改特性'
      : match[1] === '规划关系' ? !before ? '创建规划关系' : '修改规划关系' : match[1];
    return [typeof title === 'string' && title.trim() ? `${action}：${title}` : action, ...changes].join('；');
  } catch { return; }
}

/** Existing snapshots already carry the human change description; retain the raw record separately. */
export function auditSummary(summary: string, context?: Pick<AuditLog, 'action' | 'entityType'>): string {
  try {
    const value = JSON.parse(summary);
    if (context?.entityType === 'work_item' && ['cancel', 'delete'].includes(context.action)
      && snapshot(value) && typeof value.title === 'string' && value.title.trim()
      && Object.keys(value).every(key => ['title', 'reason', 'removedDependencies', 'milestones'].includes(key))
      && (value.reason === undefined || typeof value.reason === 'string')
      && Array.isArray(value.removedDependencies) && value.removedDependencies.every(snapshot)
      && (value.milestones === undefined || Array.isArray(value.milestones) && value.milestones.every((item: unknown) => typeof snapshot(item)?.title === 'string'))) {
      const changes = [`${value.title}：工作项已移除`];
      if (value.reason?.trim()) changes.push(`取消原因：${value.reason.trim()}`);
      if (value.removedDependencies.length) changes.push(`已解除 ${value.removedDependencies.length} 条依赖`);
      if (value.milestones?.length) changes.push('需人工确认的里程碑：' + value.milestones.map((item: {title: string}) => item.title).join('、'));
      return changes.join('；');
    }
    if (!value || typeof value !== 'object' || typeof value.reason !== 'string' || !value.reason.trim()
      || ![value.before, value.after].some(snapshot => snapshot && typeof snapshot === 'object')) return summary;
    const title = value.after?.title || value.before?.title;
    let reason = value.reason;
    const before = snapshot(value.before), after = snapshot(value.after);
    if (reason === '修正历史记录' && before && after) {
      const changes: string[] = [];
      const scalar = (entry: unknown) => entry === null || typeof entry === 'string';
      for (const [key, label] of Object.entries({ sourceRef: '范围标识', reporter: '提出人', priority: '优先级', discoveredAt: '发现日期', dueDate: '目标日期', nextReviewAt: '下次核对日期' })) {
        if (scalar(before[key]) && scalar(after[key]) && before[key] !== after[key]) changes.push(`${label}：${before[key] || '未设置'} → ${after[key] || '未设置'}`);
      }
      if (scalar(before.requirementId) && scalar(after.requirementId) && before.requirementId !== after.requirementId) changes.push('关联需求已调整');
      if (changes.length) reason = changes.join('；');
    }
    return typeof title === 'string' && title.trim() ? `${title}：${reason}` : reason;
  } catch { return textSnapshotSummary(summary) || summary; }
}

export function auditObjectUrl(item: Pick<AuditLog, 'entityType' | 'entityId' | 'projectId' | 'objectDeleted' | 'workItemDeleted' | 'workItemRequirementId'>): string | undefined {
  if (!item.projectId || !item.entityId) return;
  if (item.entityType === 'work_item' && item.workItemDeleted) return item.workItemRequirementId ? '/?' + workspaceParams({
    projectId: item.projectId, view: 'list', scope: {kind: 'project', id: item.projectId}, inspector: item.workItemRequirementId, detailTab: 'history',
  }) : undefined;
  if (item.objectDeleted) return;
  if (item.entityType === 'issue') return '/issues?' + new URLSearchParams({ projectId: item.projectId, detailId: item.entityId, detailTab: 'basic' });
  const prefix: Record<string, string> = { requirement: '', work_item: '', feature: 'feature:', feature_phase: 'phase:' };
  if (item.entityType !== 'project' && !Object.hasOwn(prefix, item.entityType)) return;
  return '/?' + workspaceParams({ projectId: item.projectId, view: 'list', scope: { kind: 'project', id: item.projectId },
    inspector: item.entityType === 'project' ? undefined : prefix[item.entityType] + item.entityId });
}
