import {compareProcessingPriority,processingPriority} from '../../shared/delivery';
import {deriveRequirementMetrics} from '../../shared/domain';
import type { AuthorizationActor } from '../authorization';
import { canContributeProject, canManageProject } from '../authorization';
import { businessDayDelta, isOverdueByWorkday, todayIso } from '../../shared/domain';
import {
  actionReasonLabels,
  type ActionItem,
  type ActionItemsPage,
  type ActionReasonCode,
  type ActionSeverity,
} from '../../shared/action-items';
import { requirementAnalysisSnapshots,listRequirements, type RequirementRecord } from './requirements';
import { rows } from './support';
import { getPathAnalysis } from './paths';
import { loadLatestCommitment } from './commitments';

type Filters = {
  projectId: string;
  severity?: string;
  reason?: string;
  ownerId?: string;
  page?: number;
  pageSize?: number;
};

type WorkItemRow = {
  id: string; requirementId: string; requirementTitle: string; requirementOwnerId: string | null;
  title: string; ownerId: string | null; ownerName: string | null; ownerValid: number; status: string;
  blockedAt:string|null; plannedEnd: string | null; updatedAt: string; actorCollaborator: number;
};

type IssueRow = {
  id: string; requirementId: string | null; requirementTitle: string | null; requirementOwnerId: string | null;
  title: string; ownerId: string | null; ownerName: string | null; dueDate: string | null; nextReviewAt:string|null; updatedAt: string;
};

const reasonSeverity: Record<ActionReasonCode, ActionSeverity> = {forecast_review:'medium',blocker_resolved:'medium',follow_up:'medium',commitment_scope:'medium',
  outside_delivery:'medium',acceptor_unavailable:'medium',
  path_blocked: 'high',
  planning: 'low',
  missing_owner: 'low',
  missing_work_items: 'low',
  incomplete_schedule: 'low',
  high_risk: 'high',
  delayed: 'high',
  pending_acceptance: 'medium',
  blocked: 'high',
  unassigned: 'medium',
  owner_unavailable: 'medium',
  overdue: 'high',
};

const severityWeight: Record<ActionSeverity, number> = { high: 3, medium: 2, low: 1 };

export function deriveRequirementActionReasons(requirement: Pick<RequirementRecord,
  'status' | 'ownerId' | 'ownerValid' | 'highRisk' | 'delayed' | 'workItems' | 'deliveryScope' | 'executionMode' | 'acceptanceOwnerId' | 'acceptanceOwnerValid' | 'scheduleComplete' | 'readinessIssues'>): ActionReasonCode[] {
  if (['completed', 'cancelled'].includes(requirement.status)) return [];
  const activeWorkItems = (requirement.workItems || []).filter((item) => item.status !== 'cancelled');
  const reasonCodes: ActionReasonCode[] = [];
  if(requirement.deliveryScope==='candidate'&&['in_progress','blocked','pending_acceptance'].includes(requirement.status))reasonCodes.push('outside_delivery');
  if(requirement.acceptanceOwnerId&&!requirement.acceptanceOwnerValid)reasonCodes.push('acceptor_unavailable');
  if (requirement.status === 'planning') reasonCodes.push('planning');
  if (!requirement.ownerId||requirement.ownerValid!==undefined&&!requirement.ownerValid) reasonCodes.push('missing_owner');
  if (!activeWorkItems.length&&requirement.executionMode!=='direct') reasonCodes.push('missing_work_items');
  else if (activeWorkItems.some((item) => !item.plannedStart || !item.plannedEnd)) reasonCodes.push('incomplete_schedule');
  if(requirement.executionMode==='direct'&&requirement.scheduleComplete===false)reasonCodes.push('incomplete_schedule');
  if(requirement.executionMode==='direct'&&requirement.status==='blocked')reasonCodes.push('blocked');
  if (requirement.highRisk) reasonCodes.push('high_risk');
  if (requirement.delayed) reasonCodes.push('delayed');
  if (requirement.status === 'pending_acceptance') reasonCodes.push('pending_acceptance');
  return reasonCodes;
}

export function deriveWorkItemActionReasons(workItem: { status: string; ownerId: string | null; ownerValid?: number | boolean }): ActionReasonCode[] {
  if (['completed', 'cancelled'].includes(workItem.status)) return [];
  const reasonCodes: ActionReasonCode[] = [];
  if (workItem.status === 'blocked') reasonCodes.push('blocked');
  if (!workItem.ownerId) reasonCodes.push('unassigned');
  else if (workItem.ownerValid !== undefined && !workItem.ownerValid) reasonCodes.push('owner_unavailable');
  return reasonCodes;
}

function makeItem(input: Omit<ActionItem, 'id' | 'severity' | 'reasons' | 'reasonCodes'> & { reasonCodes: ActionReasonCode[] }): ActionItem {
  const reasonCodes = [...new Set(input.reasonCodes)];
  const severity = reasonCodes.reduce<ActionSeverity>(
    (current, reason) => severityWeight[reasonSeverity[reason]] > severityWeight[current] ? reasonSeverity[reason] : current,
    'low',
  );
  return {
    ...input,
    id: `${input.sourceType}:${input.sourceId}`,
    severity,
    reasonCodes,
    reasons: reasonCodes.map((code) => ({ code, label: actionReasonLabels[code] })),
  };
}

function emptyPage(page: number, pageSize: number, asOfDate: string): ActionItemsPage {
  return {
    asOfDate,
    items: [], total: 0, page, pageSize, pages: 0,
    ownerOptions: [], hasUnassigned: false,
    summary: { total: 0, high: 0, medium: 0, low: 0, byReason: {} },
  };
}

export function listActionItems(
  filters: Filters,
  actor: AuthorizationActor,
  loadedRequirements?: RequirementRecord[],
  asOfDate = todayIso(),
): ActionItemsPage {
  const requestedPage = Math.max(1, Math.trunc(Number(filters.page) || 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(filters.pageSize) || 20)));
  const manager = canManageProject(actor, filters.projectId);
  if (!manager && !canContributeProject(actor, filters.projectId)) return emptyPage(1, pageSize, asOfDate);
  const personId = actor.personId;
  const today = asOfDate;
  const items: ActionItem[] = [];
  const requirements=loadedRequirements||listRequirements({projectId:filters.projectId},today);
  const latestCommitment=manager?loadLatestCommitment(filters.projectId):undefined;
  const committedIds=new Set(latestCommitment?.items.filter(i=>i.kind==='requirement').map(i=>i.id));
  const pathAnalysis=requirementAnalysisSnapshots.get(requirements)?.get(filters.projectId)||(requirements.some(r=>r.pathRisk)?getPathAnalysis(filters.projectId,undefined,asOfDate):undefined);
  const requirementsById=new Map(requirements.map(r=>[r.id,r]));
  const pathNodes=new Map(pathAnalysis?.nodes.map(n=>[n.id,n])||[]);
  const sourcesById=new Map<string,NonNullable<typeof pathAnalysis>['blockers'][number]>();
  for(const source of pathAnalysis?.blockers||[]){for(const id of [source.nodeId,source.workItemId,...(/^(execute|acceptance):/.test(source.nodeId)?[source.requirementId]:[])])if(id&&!sourcesById.has(id))sourcesById.set(id,source);}
  const pathBlockers=new Map(pathAnalysis?.blockers.filter(b=>b.workItemId&&b.critical).map(b=>[b.workItemId!,b])||[]);

  for (const requirement of requirements) {
    if (!manager && requirement.ownerId !== personId&&!(requirement.acceptanceOwnerValid&&requirement.acceptanceOwnerId===personId)&&requirement.blockerCoordination?.coordinatorId!==personId) continue;
    const scopeChanged=!!latestCommitment&&requirement.status!=='completed'&&committedIds.has(requirement.id)!==(requirement.deliveryScope!=='candidate'&&requirement.status!=='cancelled');
    if(!scopeChanged&&requirement.deliveryScope==='candidate'&&!requirement.pathRisk?.inDeliveryNetwork&&!['in_progress','blocked','pending_acceptance'].includes(requirement.status))continue;
    const reasonCodes = deriveRequirementActionReasons(requirement);
    if(scopeChanged)reasonCodes.push('commitment_scope');
    if(requirement.forecastBasis?.needsReview)reasonCodes.push('forecast_review');
    if (!reasonCodes.length) continue;
    items.push(makeItem({
      sourceType: 'requirement', sourceId: requirement.id, projectId: requirement.projectId,
      requirementId: requirement.id, contextTitle: null, title: requirement.title, reasonCodes,
      ownerId: reasonCodes.some(c=>c==='missing_owner'||c==='acceptor_unavailable')?null:requirement.status==='pending_acceptance'?requirement.acceptanceOwnerValid?requirement.acceptanceOwnerId||null:null:requirement.ownerId, ownerName: reasonCodes.some(c=>c==='missing_owner'||c==='acceptor_unavailable')?'项目经理':requirement.status==='pending_acceptance'?requirement.acceptanceOwnerValid?requirement.acceptanceOwnerName||'项目经理':'项目经理':requirement.ownerName||'项目经理', dueDate: requirement.plannedEnd,
      overdueWorkdays: requirement.delayed ? Math.max(0, requirement.finishVariance || 0) : 0,
      targetPath: `/requirements/${requirement.id}`, updatedAt: requirement.updatedAt,
    }));
  }

  const workItems = rows<WorkItemRow>(`SELECT w.id, w.requirement_id AS requirementId, r.title AS requirementTitle,
    r.owner_id AS requirementOwnerId, w.title, w.owner_id AS ownerId, p.name AS ownerName, w.status,
    w.planned_end AS plannedEnd,w.blocked_at AS blockedAt, w.updated_at AS updatedAt,
    EXISTS (SELECT 1 FROM project_people pp JOIN accounts a ON a.person_id=pp.person_id
      WHERE pp.project_id=r.project_id AND pp.person_id=w.owner_id AND pp.project_role IN ('member','manager')
        AND p.active=1 AND p.deleted_at IS NULL AND a.status='active' AND a.deleted_at IS NULL) AS ownerValid,
    CASE WHEN ? IS NOT NULL AND EXISTS (
      SELECT 1 FROM work_item_collaborators c WHERE c.work_item_id=w.id AND c.person_id=?
    ) THEN 1 ELSE 0 END AS actorCollaborator
    FROM work_items w JOIN requirements r ON r.id=w.requirement_id
    LEFT JOIN people p ON p.id=w.owner_id
    WHERE r.project_id=? AND r.deleted_at IS NULL AND r.status NOT IN ('completed','cancelled')
      AND w.status NOT IN ('completed','cancelled')`, personId, personId, filters.projectId);
  const workById=new Map(workItems.map(w=>[w.id,w]));
  for (const workItem of workItems) {
    if (!manager && workItem.requirementOwnerId !== personId && workItem.ownerId !== personId && !workItem.actorCollaborator&&pathNodes.get(workItem.id)?.blockerCoordination?.coordinatorId!==personId) continue;
    const parent=requirementsById.get(workItem.requirementId);if(parent?.deliveryScope==='candidate'&&!parent.pathRisk?.inDeliveryNetwork)continue;
    const reasonCodes = deriveWorkItemActionReasons(workItem);
    if(pathNodes.get(workItem.id)?.forecastBasis?.needsReview)reasonCodes.push('forecast_review');
    const pathBlocker=pathBlockers.get(workItem.id);
    if(pathBlocker)reasonCodes.push('path_blocked');
    if (!reasonCodes.length) continue;
    items.push(makeItem({
      sourceType: 'work_item', sourceId: workItem.id, projectId: filters.projectId,
      requirementId: workItem.requirementId, contextTitle: workItem.requirementTitle, title: workItem.title,
      reasonCodes, ownerId: workItem.ownerId, ownerName: workItem.ownerName, dueDate: workItem.plannedEnd,
      overdueWorkdays: isOverdueByWorkday(workItem.plannedEnd, today)
        ? Math.max(0, businessDayDelta(workItem.plannedEnd, today)) : 0,
      targetPath: `/requirements/${workItem.requirementId}?workItemId=${encodeURIComponent(workItem.id)}${pathBlocker?'&view=path&target=project':''}`, updatedAt: workItem.updatedAt,
    }));
  }

  const issues = rows<IssueRow>(`SELECT i.id, i.requirement_id AS requirementId, r.title AS requirementTitle,
    r.owner_id AS requirementOwnerId, i.title, i.owner_id AS ownerId, p.name AS ownerName,
    i.due_date AS dueDate, i.next_review_at AS nextReviewAt, i.updated_at AS updatedAt
    FROM issues i LEFT JOIN requirements r ON r.id=i.requirement_id
    LEFT JOIN people p ON p.id=i.owner_id
    WHERE i.project_id=? AND i.status<>'resolved'
      AND (i.requirement_id IS NULL OR r.deleted_at IS NULL)`, filters.projectId);
  for (const issue of issues) {
    if (!manager && issue.ownerId !== personId && issue.requirementOwnerId !== personId) continue;
    const reasonCodes: ActionReasonCode[] = [];
    if (isOverdueByWorkday(issue.dueDate, today)) reasonCodes.push('overdue');
    if (!issue.ownerId) reasonCodes.push('unassigned');
    if(issue.nextReviewAt&&issue.nextReviewAt<=today)reasonCodes.push('follow_up');
    if (!reasonCodes.length) continue;
    items.push(makeItem({
      sourceType: 'issue', sourceId: issue.id, projectId: filters.projectId,
      requirementId: issue.requirementId, contextTitle: issue.requirementTitle, title: issue.title,
      reasonCodes, ownerId: issue.ownerId, ownerName: issue.ownerName, dueDate: issue.dueDate, nextReviewAt:issue.nextReviewAt,
      overdueWorkdays: isOverdueByWorkday(issue.dueDate, today) ? Math.max(0, businessDayDelta(issue.dueDate, today)) : 0,
      targetPath: `/issues?issueId=${encodeURIComponent(issue.id)}`, updatedAt: issue.updatedAt,
    }));
  }

  const visibleIds=new Set(requirements.filter(r=>manager||r.ownerId===personId||r.acceptanceOwnerValid&&r.acceptanceOwnerId===personId||r.blockerCoordination?.coordinatorId===personId||workItems.some(w=>w.requirementId===r.id&&(w.ownerId===personId||w.actorCollaborator||pathNodes.get(w.id)?.blockerCoordination?.coordinatorId===personId))).map(r=>r.id));
  for(const b of pathAnalysis?.blockers||[]){
    const node=pathNodes.get(b.nodeId);if(!node)continue;
    if(!manager&&(!b.requirementId||!visibleIds.has(b.requirementId)))continue;
    if(node.kind==='milestone'&&!items.some(i=>i.sourceId===node.id))items.push(makeItem({sourceType:'milestone',sourceId:node.id,projectId:filters.projectId,requirementId:node.requirementId,contextTitle:null,title:node.title,reasonCodes:['path_blocked'],ownerId:null,ownerName:'项目经理',dueDate:node.plannedEnd,overdueWorkdays:0,targetPath:node.requirementId?'/requirements/'+node.requirementId+'?view=path&pathSelected='+node.id:'/paths?pathSelected='+node.id,updatedAt:today}));
  }
  for(const item of items){
    const parent=requirementsById.get(item.requirementId||''),source=sourcesById.get(item.sourceId);
    const affected=[...new Set([...(source?.affectedRequirementIds||parent?.affectedRequirementIds||[]),...(parent&&parent.deliveryScope!=='candidate'?[parent.id]:[])])].filter(id=>visibleIds.has(id));
    item.affectedRequirements=affected.map(id=>({id,title:requirementsById.get(id)!.title}));
    const node=pathNodes.get(item.sourceType==='requirement'?'execute:'+item.sourceId:item.sourceId);
    const whole=item.sourceType==='requirement',known=node&&!node.unknownReasons.length;
    const facts={...parent,...(whole?parent?.pathRisk:{}),id:item.id,status:item.reasonCodes.includes('blocked')?'blocked':'in_progress',
      blockedCritical:whole?parent?.pathRisk?.blockedCritical:!!source?.critical&&item.reasonCodes.some(c=>['blocked','path_blocked'].includes(c)),
      critical:whole?parent?.pathRisk?.critical:node?.critical,complete:whole?parent?.pathRisk?.complete:!!known,
      minFloat:whole?parent?.pathRisk?.minFloat:node?.scheduleBuffer??node?.floatDays,
      drivesLateTarget:whole?parent?.pathRisk?.drivesLateTarget:!!known&&!!node?.critical&&!!parent?.pathRisk?.drivesLateTarget,
      affectedRequirementIds:affected,riskLevel:whole?parent?.riskLevel:(item.severity==='high'?'high':'medium'),riskEvaluated:whole?parent?.riskEvaluated:true,
      inDeliveryNetwork:whole?parent?.pathRisk?.inDeliveryNetwork:node?.inScope,anomalySince:whole?parent?.prioritySince:workById.get(item.sourceId)?.blockedAt,blockedAt:parent?.blockedAt||null};
    Object.assign(item,processingPriority(facts,today),{affectedRequirementIds:affected,minFloat:facts.minFloat,riskLevel:facts.riskLevel,riskEvaluated:facts.riskEvaluated});
    const coordination=whole?parent?.blockerCoordination:node?.blockerCoordination;
    if(coordination&&item.reasonCodes.some(c=>c==='blocked'||c==='path_blocked')){item.ownerId=coordination.coordinatorId;item.ownerName=coordination.coordinatorName;item.nextReviewAt=coordination.nextReviewAt;item.coordinationIssueId=coordination.issueId;
      if(coordination.issueResolved)item.reasonCodes.push('blocker_resolved');else if(coordination.nextReviewAt&&coordination.nextReviewAt<=today)item.reasonCodes.push('follow_up');
      item.reasons=item.reasonCodes.map(code=>({code,label:actionReasonLabels[code]}));}
    item.severity=item.processingPriority==='P0'||item.processingPriority==='P1'?'high':item.processingPriority==='P3'?'low':'medium';
  }
  // Suppress only path-derived parent risk already represented by a visible source. Independent reasons remain.
  for(let i=items.length-1;i>=0;i--){const item=items[i];if(item.sourceType!=='requirement'||item.reasonCodes.some(c=>c!=='high_risk'&&c!=='blocked'))continue;
    const parent=requirementsById.get(item.sourceId)!;
    const sources=items.filter(x=>x!==item&&x.affectedRequirementIds?.includes(parent.id));
    if(!sources.length)continue;
    const base=deriveRequirementMetrics({...parent,status:parent.status==='blocked'?'in_progress':parent.status},(parent.workItems||[]).map(w=>w.status==='blocked'?{...w,status:'in_progress'}:w),today);
    const allBlockedExplained=(parent.workItems||[]).filter(w=>w.status==='blocked').every(w=>sources.some(s=>s.sourceType==='work_item'&&s.sourceId===w.id));
    const pure=item.reasonCodes.every(c=>c==='high_risk'&&!base.highRisk||c==='blocked'&&parent.executionMode!=='direct'&&allBlockedExplained);
    if(pure)items.splice(i,1);
  }
  // Typed issue references are the only cross-object grouping key. Keep independent reasons on their source.
  const linkedIssues=issues.map(i=>({...i,status:'in_progress'}));
  for(const issue of linkedIssues){if(issue.status==='resolved')continue;
    const sources=items.filter(i=>i.coordinationIssueId===issue.id&&i.reasonCodes.some(c=>c==='blocked'||c==='path_blocked'));if(!sources.length)continue;
    const existing=items.find(i=>i.sourceType==='issue'&&i.sourceId===issue.id);
    const strongest=[...sources,...existing?[existing]:[]].sort((a,b)=>compareProcessingPriority({...a,status:'blocked'},{...b,status:'blocked'}))[0];
    const grouped={...strongest,id:'issue:'+issue.id,sourceType:'issue' as const,sourceId:issue.id,title:issue.title,contextTitle:null,requirementId:issue.requirementId,targetPath:'/issues?issueId='+encodeURIComponent(issue.id)};
    const reasons=new Set<ActionReasonCode>(existing?.reasonCodes||[]),affected=new Map<string,{id:string;title:string}>();
    for(const source of sources){for(const r of source.affectedRequirements||[])affected.set(r.id,r);for(const code of source.reasonCodes)if(['blocked','path_blocked','follow_up'].includes(code))reasons.add(code);
      source.reasonCodes=source.reasonCodes.filter(c=>!['blocked','path_blocked','follow_up'].includes(c));source.reasons=source.reasonCodes.map(code=>({code,label:actionReasonLabels[code]}));
      if(!source.reasonCodes.length)items.splice(items.indexOf(source),1);
      else {const original=source.sourceType==='requirement'?requirementsById.get(source.sourceId):workById.get(source.sourceId);source.ownerId=original?.ownerId||null;source.ownerName=original?.ownerName||'项目经理';source.coordinationIssueId=null;source.nextReviewAt=null;}
    }
    for(const r of existing?.affectedRequirements||[])affected.set(r.id,r);
    if(existing)items.splice(items.indexOf(existing),1);
    grouped.reasonCodes=[...reasons];grouped.reasons=grouped.reasonCodes.map(code=>({code,label:actionReasonLabels[code]}));grouped.affectedRequirements=[...affected.values()];grouped.affectedRequirementIds=[...affected.keys()];items.push(grouped);
  }
  const byReason: Partial<Record<ActionReasonCode, number>> = {};
  for(const item of items)if(item.reasonCodes.includes('commitment_scope')){item.ownerId=null;item.ownerName='项目经理';}
  for(const item of items){
    if(!['requirement','work_item'].includes(item.sourceType)||!item.requirementId)continue;
    if(item.reasonCodes.includes('owner_unavailable')){
      item.ownerId=null;item.ownerName='项目经理';
      item.targetPath='/requirements/'+item.requirementId+'?'+new URLSearchParams({workItemId:item.sourceId});
      continue;
    }
    const parent=requirementsById.get(item.requirementId),work=item.sourceType==='work_item'?workById.get(item.sourceId):undefined;
    const canExecute=manager||!!personId&&(parent?.ownerId===personId||work?.ownerId===personId||!!work?.actorCollaborator);
    const canAccept=manager||!!personId&&parent?.acceptanceOwnerValid&&parent.acceptanceOwnerId===personId;
    const codes=item.reasonCodes;
    const action=codes.includes('pending_acceptance')&&canAccept?'accept'
      :codes.includes('commitment_scope')&&manager?'delivery-settings'
      :codes.includes('blocker_resolved')?null
      :codes.some(c=>c==='blocked'||c==='follow_up')&&(canExecute||!!personId&&item.ownerId===personId)?'follow-up'
      :codes.includes('forecast_review')&&canExecute?'forecast':null;
    if(action)item.targetPath='/requirements/'+item.requirementId+'?'+new URLSearchParams({...(work?{workItemId:work.id}:{}),action});
  }
  for (const item of items) for (const reason of item.reasonCodes) byReason[reason] = (byReason[reason] || 0) + 1;
  const summary = {
    total: items.length,
    high: items.filter((item) => item.severity === 'high').length,
    medium: items.filter((item) => item.severity === 'medium').length,
    low: items.filter((item) => item.severity === 'low').length,
    byReason,
  };
  const ownerCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const item of items) {
    if (!item.ownerId) continue;
    const current = ownerCounts.get(item.ownerId);
    if (current) current.count += 1;
    else ownerCounts.set(item.ownerId, {
      id: item.ownerId,
      name: item.ownerName || '历史负责人',
      count: 1,
    });
  }
  const ownerOptions = [...ownerCounts.values()].sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  const hasUnassigned = items.some((item) => !item.ownerId);

  let filtered = items;
  if (filters.severity) filtered = filtered.filter((item) => item.severity === filters.severity);
  if (filters.reason) filtered = filtered.filter((item) => item.reasonCodes.includes(filters.reason as ActionReasonCode));
  if (filters.ownerId) filtered = filtered.filter((item) => filters.ownerId === 'unassigned' ? !item.ownerId : item.ownerId === filters.ownerId);
  filtered.sort((a,b)=>compareProcessingPriority({...a,status:'in_progress',plannedEnd:a.dueDate},{...b,status:'in_progress',plannedEnd:b.dueDate}));

  const total = filtered.length;
  const pages = total ? Math.ceil(total / pageSize) : 0;
  const page = total ? Math.min(requestedPage, pages) : 1;
  const offset = (page - 1) * pageSize;
  return {
    asOfDate,
    items: filtered.slice(offset, offset + pageSize), total, page, pageSize,
    pages,
    ownerOptions,
    hasUnassigned,
    summary,
  };
}
