import type { Dependency, PathWork, PathInput, PathNode, PathEdge, PathRisk, PathBlocker, PathAnalysis } from './path-model';
export type { Dependency, PathMilestone, DiagramLayout, PathWork, PathRequirement, PathInput, PathNode, PathEdge, PathRisk, PathBlocker, PathAnalysis } from './path-model';
import { deriveExecutionStage } from "./execution-stage";
import { decorateForecastBasis } from './forecast-basis';
import { processingPriority } from './delivery';
import { addBusinessDays, businessDayDelta, businessDaysInclusive, calculateWorkItemGap, deriveRequirementMetrics } from './domain';
import { arrangeLate } from './late-schedule';












export const dependencySource=(d:Dependency)=>d.sourceMilestoneId||d.sourceWorkItemId||acceptanceId(d.sourceRequirementId);
export const dependencyTarget=(d:Dependency)=>d.targetMilestoneId||d.targetWorkItemId||startId(d.targetRequirementId);

export const startId = (id: string) => `start:${id}`;
export const acceptanceId = (id: string) => `acceptance:${id}`;
/** Virtual execution nodes keep their role while their owning requirement receives a saved ID. */
export function remapPathNodeId(id:string,mapping:Readonly<Record<string,string>>):string {
  if(mapping[id])return mapping[id];
  for(const prefix of ['start:','acceptance:','execute:'])if(id.startsWith(prefix))return prefix+(mapping[id.slice(prefix.length)]||id.slice(prefix.length));
  return id;
}
export const projectTarget = 'project';

export class DependencyCycleError extends Error {
  constructor(public nodeIds: string[], public edgeIds: string[] = []) {
    super('依赖形成执行循环，请调整前置关系');
  }
}

/** Stable Kahn traversal. A requirement projection may contain cycles; this execution graph must not. */
export function topologicalOrder(ids: string[], edges: Array<{ source: string; target: string }>) {
  const degree = new Map(ids.map(id => [id, 0]));
  const next = new Map(ids.map(id => [id, [] as string[]]));
  for (const edge of edges) {
    if (!degree.has(edge.source) || !degree.has(edge.target)) throw new Error('依赖端点不存在');
    degree.set(edge.target, degree.get(edge.target)! + 1); next.get(edge.source)!.push(edge.target);
  }
  const ready = ids.filter(id => degree.get(id) === 0), result: string[] = [];
  for (let i = 0; i < ready.length; i++) {
    const id = ready[i]; result.push(id);
    for (const child of next.get(id)!) {
      const value = degree.get(child)! - 1; degree.set(child, value); if (value === 0) ready.push(child);
    }
  }
  if (result.length !== ids.length) {
    const remaining = new Set(ids.filter(id => degree.get(id)! > 0));
    const color = new Map<string, number>(), parent = new Map<string, string>();
    for (const root of remaining) {
      if (color.has(root)) continue;
      color.set(root, 1);
      const stack = [{ id: root, index: 0 }];
      while (stack.length) {
        const frame = stack.at(-1)!, children = next.get(frame.id)!;
        if (frame.index === children.length) { color.set(frame.id, 2); stack.pop(); continue; }
        const child = children[frame.index++];
        if (!remaining.has(child)) continue;
        if (color.get(child) === 1) {
          const cycle = [frame.id];
          while (cycle.at(-1) !== child) cycle.push(parent.get(cycle.at(-1)!)!);
          cycle.reverse();
          const pairs = cycle.map((source, i) => ({ source, target: cycle[(i + 1) % cycle.length] }));
          const edgeIds = pairs.flatMap(pair => edges.filter(e => e.source === pair.source && e.target === pair.target)
            .map(e => (e as { id?: string }).id).filter((id): id is string => !!id));
          throw new DependencyCycleError(cycle, edgeIds);
        }
        if (!color.has(child)) { color.set(child, 1); parent.set(child, frame.id); stack.push({ id: child, index: 0 }); }
      }
    }
    throw new DependencyCycleError([...remaining]);
  }
  return result;
}

type Internal = PathNode & { release: number; fixed: number | null; planDuration: number; planRelease: number; planFinish: number; planStart: number; actualStart: number | null };

export function analysePaths(input: PathInput, requestedTarget = projectTarget): PathAnalysis {
  const base = addBusinessDays(input.asOfDate, 0);
  const dates=new Map<number,string>(), starts=new Map<string,number>(), finishes=new Map<string,number>();
  dates.set(0,base);let firstDate=0,lastDate=0;
  const dateAt=(offset:number)=>{while(offset>lastDate){dates.set(lastDate+1,addBusinessDays(dates.get(lastDate)!,1));lastDate++;}while(offset<firstDate){dates.set(firstDate-1,addBusinessDays(dates.get(firstDate)!,-1));firstDate--;}return dates.get(offset)!;};
  const toStart = (date: string) => {if(!starts.has(date))starts.set(date,businessDayDelta(base,addBusinessDays(date.slice(0,10),0)));return starts.get(date)!;};
  const toFinish = (date: string) => {if(!finishes.has(date))finishes.set(date,businessDayDelta(base,date.slice(0,10))+1);return finishes.get(date)!;};
  const endDate = (boundary: number) => dateAt(boundary-1);
  const nodes: Internal[] = [], edges: PathEdge[] = [];
  const reqById = new Map(input.requirements.map(r => [r.id, r]));
  const works = new Map(input.requirements.map(r => [r.id, [] as PathWork[]]));
  input.workItems.forEach(w => works.get(w.requirementId)?.push(w));
  const viewMetrics = new Map(input.requirements.map(r => [r.id,
    deriveRequirementMetrics(r, works.get(r.id)!, input.asOfDate, input.highRiskDelayDays),
  ]));
  for(const r of input.requirements)if(r.executionMode==='direct')works.get(r.id)!.push({id:'execute:'+r.id,requirementId:r.id,title:r.title,status:r.status,progress:r.progress||0,plannedStart:r.plannedStart,plannedEnd:r.plannedEnd,actualStart:r.actualStart||null,actualEnd:r.actualEnd||null,durationDays:r.durationDays||null,earliestStart:null,unblockEstimate:r.unblockEstimate||null,forecastEnd:r.forecastEnd||null,forecastDuration:r.forecastDuration||null,forecastReadyAt:r.forecastReadyAt||null,blockedAt:r.blockedAt||null,blockedReason:r.blockedReason||null,milestoneLabel:null,ownerName:r.ownerName,ownerId:r.ownerId,assigneeIds:r.ownerId?[r.ownerId]:[],assigneeNames:r.ownerName?[r.ownerName]:[]});
  const referenced = new Set(input.dependencies.flatMap(d => [d.sourceWorkItemId, d.targetWorkItemId].filter((x): x is string => !!x)));
  const add = (id: string, requirementId: string | null, kind: Internal['kind'], title: string): Internal => {
    const n: Internal = { id, requirementId, workItemId: kind === 'work' ? id : null, kind, title, status: 'not_started', ownerName: null,
      milestoneLabel: null, plannedStart: null, plannedEnd: null, forecastStart: null, forecastEnd: null, remainingDays: 0,
      earliestStart: 0, earliestFinish: 0, floatDays: null, critical: false, planCritical: false, nearCritical: false, inScope: false,
      unknownReasons: [], ownReasons: [], source: '', riskLevel: 'low', complete: false, release: 0, fixed: null,
      estimate:{durationDays:null,earliestStart:null,unblockEstimate:null,forecastEnd:null},
      planDuration: 0, planRelease: 0, planFinish: 0, planStart: 0, actualStart: null };
    nodes.push(n); return n;
  };
  const link = (source: string, target: string, dependencyId: string | null = null) => edges.push({ id: dependencyId || `${source}>${target}`, source, target, dependencyId, critical: false });
  for (const r of input.requirements) {
    const start = add(startId(r.id), r.id, 'start', `${r.title} · 开始条件`);
    start.release = r.scheduleAnchor ? Math.max(0, toStart(r.scheduleAnchor)) : 0;
    start.planRelease = toStart(r.scheduleAnchor || r.plannedStart || base);
    const active = works.get(r.id)!.filter(w => w.status !== 'cancelled');
    const end = add(acceptanceId(r.id), r.id, 'acceptance', `${r.title} · 完成`);
    end.ownerName = r.ownerName; end.ownerId=r.ownerId; end.status = r.status;
    end.plannedEnd = viewMetrics.get(r.id)!.scheduleComplete ? r.plannedEnd : null;
    end.source = '按工作完成日期计算';
    if (r.status === 'completed' || active.length && active.every(w=>w.status==='completed')) {
      const dates=active.map(w=>w.actualEnd).filter((v):v is string=>!!v).sort();
      end.complete=true;
      if(dates.length===active.length&&dates.length){end.fixed=toFinish(dates.at(-1)!);end.forecastEnd=dates.at(-1)!.slice(0,10);}
      else end.ownReasons.push('实际完成日期未记录');
    } else if (r.status === 'cancelled') end.ownReasons.push('前置需求已取消');
    const actualStarts = active.flatMap(w => w.actualStart ? [toStart(w.actualStart)] : []);
    if (actualStarts.length) { start.release = Math.min(...actualStarts); start.actualStart = start.release; }
    if (!active.length && !end.complete) end.ownReasons.push('缺少有效工作项');
    for (const w of works.get(r.id)!) {
      if (w.status === 'cancelled' && !referenced.has(w.id)) continue;
      const n = add(w.id, r.id, r.executionMode==='direct'?'execution':'work', w.title);
      Object.assign(n, { progress:w.progress,progressWeight:w.progressWeight,workStage:w.workStage,version:w.version,status: w.status, ownerName: w.ownerName, milestoneLabel: w.milestoneLabel, ownerId:w.ownerId,assigneeIds:w.assigneeIds,assigneeNames:w.assigneeNames, plannedStart: w.plannedStart, plannedEnd: w.plannedEnd,
        delayed:w.status!=='cancelled'&&calculateWorkItemGap(w,input.asOfDate).finishVariance>0,scheduleComplete:!!w.plannedStart&&!!w.plannedEnd });
      n.estimate={durationDays:w.durationDays,earliestStart:w.earliestStart,unblockEstimate:w.unblockEstimate,forecastEnd:w.forecastEnd};
      n.arrangement=w.arrangement||'early';n.arrangementAnchor=w.arrangementAnchor;
      const duration = w.durationDays ?? (w.plannedStart && w.plannedEnd ? businessDaysInclusive(w.plannedStart, w.plannedEnd) : null);
      n.planDuration = duration ?? 0; n.planRelease = w.earliestStart ? toStart(w.earliestStart) : start.planRelease;
      n.remainingDays = w.actualStart ? Math.max(1, Math.ceil((duration ?? 0) * (1 - w.progress / 100))) : duration ?? 0;
      n.release = Math.max(0, w.earliestStart ? toStart(w.earliestStart) : 0);
      n.actualStart = w.actualStart ? toStart(w.actualStart) : null;
      n.source = w.actualStart ? '按进度估算剩余工期' : '预计工期';
      if (w.status === 'completed' && w.actualEnd) { n.fixed = toFinish(w.actualEnd); n.remainingDays = 0; n.complete = true; n.source = '实际完成'; n.forecastStart=(w.actualStart||w.actualEnd).slice(0,10);n.forecastEnd=w.actualEnd.slice(0,10); }
      else {
        if (!duration&&!(w.forecastEnd&&w.forecastDuration&&w.forecastReadyAt)) n.ownReasons.push('预计工期缺失');
        if (w.status === 'cancelled') n.ownReasons.push('前置工作已取消');
        if (w.forecastEnd) {
          if (w.forecastEnd < input.asOfDate) n.ownReasons.push('人工预测已过期');
          else if (w.forecastDuration && w.forecastReadyAt) {
            // Preserve estimated effort if upstream moves; consume elapsed working days only after readiness.
            n.remainingDays = w.actualStart&&w.status==='in_progress' ? Math.max(1, w.forecastDuration - Math.max(0, businessDayDelta(w.forecastReadyAt, base))) : w.forecastDuration;
            n.source = '人工预测推算剩余工期';
          } else n.ownReasons.push('人工预测需重新核对');
        }
      }
      if (w.status !== 'cancelled') link(n.id, end.id);
    }
    if (!active.length) link(start.id, end.id);
  }
  for(const m of input.milestones||[]){
    const n=add(m.id,m.requirementId,'milestone',m.title);n.plannedEnd=m.targetDate;n.source='零工期里程碑';
    if(m.achievedAt){n.complete=true;n.fixed=toFinish(m.achievedAt);n.status='completed';n.source='实际达成';n.forecastEnd=m.achievedAt.slice(0,10);}
    else if(m.cancelled){n.status='cancelled';n.ownReasons.push('前置里程碑已取消');}
    else if(m.confirmationMode==='manual'||!input.dependencies.some(d=>d.targetMilestoneId===m.id)){
      if(m.targetDate&&m.targetDate>=input.asOfDate)n.release=toFinish(m.targetDate);
      else n.ownReasons.push('里程碑等待人工确认，日期待确认');
    }
    // Milestones are independent dates; only explicit dependency edges affect work completion.
  }
  for (const d of input.dependencies) link(dependencySource(d),dependencyTarget(d),d.id);
  const internalTargets = new Set(input.dependencies.filter(d => d.sourceRequirementId === d.targetRequirementId && (d.sourceWorkItemId||d.sourceMilestoneId) && d.targetWorkItemId).map(d => d.targetWorkItemId!));
  for (const n of nodes) if ((n.kind === 'work'||n.kind==='execution') && !internalTargets.has(n.id)) link(startId(n.requirementId!), n.id);
  add(projectTarget, null, 'project', `${input.projectName} · 项目交付`);
  const eligible = input.requirements.filter(r => !r.deletedAt && !['completed', 'cancelled'].includes(r.status));
  eligible.forEach(r => link(acceptanceId(r.id), projectTarget));
  (input.milestones||[]).filter(m=>!m.requirementId&&!m.cancelled).forEach(m=>link(m.id,projectTarget));
  const byId = new Map(nodes.map(n => [n.id, n]));
  if (!byId.has(requestedTarget)) throw new Error('分析目标不存在');
  const order = topologicalOrder(nodes.map(n => n.id), edges);
  const incoming = new Map(nodes.map(n => [n.id, [] as PathEdge[]])), outgoing = new Map(nodes.map(n => [n.id, [] as PathEdge[]]));
  edges.forEach(e => { incoming.get(e.target)!.push(e); outgoing.get(e.source)!.push(e); });
  const workById=new Map(input.workItems.map(w=>[w.id,w]));
  const acknowledged=(n:Internal,e:PathEdge)=>!!e.dependencyId&&(n.kind==='start'?reqById.get(n.requirementId!)?.acknowledgedDependencies:workById.get(n.id)?.acknowledgedDependencies)?.includes(e.dependencyId);
  const forecastParents=(n:Internal)=>incoming.get(n.id)!.filter(e=>!acknowledged(n,e)).map(e=>byId.get(e.source)!);
  for (const id of order) {
    const n = byId.get(id)!, parents = forecastParents(n);
    n.startAcknowledged=incoming.get(id)!.some(e=>acknowledged(n,e));
    n.planStart = Math.max(n.planRelease, ...incoming.get(id)!.map(e=>byId.get(e.source)!.planFinish)); n.planFinish = n.planStart + n.planDuration;
    if (n.fixed !== null) { n.earliestStart = n.earliestFinish = n.fixed; n.unknownReasons = []; }
    else {
      n.earliestStart = Math.max(n.release, ...parents.map(p => n.actualStart!==null&&p.complete?p.earliestFinish-1:p.earliestFinish));
      if (n.actualStart !== null && parents.some(p => !p.complete && p.kind !== 'start' || (p.complete?p.earliestFinish-1:p.earliestFinish) > n.actualStart!)) n.ownReasons.push('已开始但前置条件尚未满足，请核对依赖');
      n.earliestFinish = n.earliestStart + n.remainingDays;
      n.unknownReasons = [...new Set([...n.ownReasons, ...parents.flatMap(p => p.unknownReasons)])];
    }
    // 工作日偏移用于依赖计算；已完成对象显示记录的实际日期。
    n.forecastStart = n.unknownReasons.length ? null : n.complete ? n.forecastStart ?? (n.actualStart === null ? endDate(n.earliestFinish) : dateAt(n.actualStart)) : dateAt(n.earliestStart);
    n.forecastEnd = n.unknownReasons.length ? null : n.complete&&n.forecastEnd ? n.forecastEnd : n.kind==='start' ? dateAt(n.earliestStart) : endDate(n.earliestFinish);if(n.kind==='milestone'||n.kind==='acceptance')n.forecastStart=n.forecastEnd;
  }
  const scopeOf = (target: string, plan=false) => {
    const set = new Set<string>([target]), queue = [target];
    for (let i = 0; i < queue.length; i++) {
      // Fulfilled events are boundaries; current rework upstream cannot undo recorded delivery.
      if (byId.get(queue[i])!.complete) continue;
      for (const e of incoming.get(queue[i])!) if ((plan||!acknowledged(byId.get(e.target)!,e))&&!set.has(e.source)) { set.add(e.source); queue.push(e.source); }
    }
    return set;
  };
  const criticalFor = (target: string, plan = false) => {
    const scope = scopeOf(target,plan), latest = new Map<string, number>(), floats = new Map<string, number>(), critical = new Set<string>();
    const t = byId.get(target)!; latest.set(target, plan ? t.planFinish : t.earliestFinish);
    const complete = plan ? [...scope].every(id => !byId.get(id)!.ownReasons.some(x => ['预计工期缺失', '依赖尚未核对', '缺少有效工作项'].includes(x))) : !t.unknownReasons.length;
    if (complete) for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i], n = byId.get(id)!; if (!scope.has(id)) continue;
      const lf = latest.get(id); if (lf === undefined) continue;
      const ls = lf - (plan ? n.planDuration : n.remainingDays);
      const f = Math.max(0, ls - (plan ? n.planStart : n.earliestStart)); floats.set(id, f);
      if (f === 0 && !n.complete) critical.add(id);
      if (!n.complete) for (const e of incoming.get(id)!.filter(e=>plan||!acknowledged(n,e))) latest.set(e.source, Math.min(latest.get(e.source) ?? Infinity, ls));
    }
    return { scope, floats, critical, complete };
  };
  const current = criticalFor(requestedTarget), plan = criticalFor(requestedTarget, true);
  const global = criticalFor(projectTarget), globalPlan = criticalFor(projectTarget, true);
  const arranged=arrangeLate(order,nodes.map(n=>({id:n.id,start:n.earliestStart,finish:n.earliestFinish,duration:n.remainingDays,arrangement:n.arrangement,anchor:n.arrangementAnchor,movable:n.status==='not_started'&&n.kind==='work',reliable:!n.unknownReasons.length})),edges.filter(e=>!acknowledged(byId.get(e.target)!,e)));
  for(const n of nodes){const s=arranged.get(n.id)!,unreliable=n.unknownReasons.length||n.arrangement==='late'&&s.buffer===null;n.scheduledStart=n.complete?n.forecastStart:unreliable?null:dateAt(s.start);n.scheduledEnd=n.complete?n.forecastEnd:unreliable?null:n.kind==='start'?dateAt(s.start):endDate(s.finish);if(n.kind==='milestone'||n.kind==='acceptance')n.scheduledStart=n.scheduledEnd;n.scheduleBuffer=n.complete?null:s.buffer;if(n.arrangement==='late'&&n.status==='not_started'){n.forecastStart=n.scheduledStart;n.forecastEnd=n.scheduledEnd;}}
  const lateDrivers = new Set<string>();
  for (const r of input.requirements) {
    const end = byId.get(acceptanceId(r.id))!;
    if (!r.deletedAt && !['cancelled', 'completed', 'planning'].includes(r.status) && end.plannedEnd && !end.unknownReasons.length && end.earliestFinish > toFinish(end.plannedEnd)) {
      const queue = [end.id], visited = new Set(queue);
      for (let i = 0; i < queue.length; i++) {
        const n = byId.get(queue[i])!; if (n.complete) continue; lateDrivers.add(n.id);
        for (const e of incoming.get(n.id)!) if (!acknowledged(n,e) && byId.get(e.source)!.earliestFinish === n.earliestStart && !visited.has(e.source)) { visited.add(e.source); queue.push(e.source); }
      }
    }
  }
  if (input.projectEnd && global.complete && byId.get(projectTarget)!.earliestFinish > toFinish(input.projectEnd)) global.critical.forEach(id => lateDrivers.add(id));
  // Attribute an overdue wait to its actionable source, rather than duplicating every waiting successor.
  const roots=new Map<string,Set<string>>(), waitingReasons=new Map<string,Set<string>>();
  for(const id of order){
    const n=byId.get(id)!,parents=forecastParents(n).filter(p=>!p.complete);
    if(n.complete){roots.set(id,new Set());continue;}
    const inherited=new Set(parents.flatMap(p=>[...roots.get(p.id)!]));
    roots.set(id,n.kind==='work'&&n.status!=='not_started'?new Set([id]):inherited.size?inherited:n.kind==='start'||n.kind==='project'?new Set():new Set([id]));
    if(n.kind!=='work'||n.status!=='not_started'||!n.plannedStart)continue;
    const planned=toStart(n.plannedStart);
    for(const parent of parents){
      if(planned>0&&(parent.unknownReasons.length||parent.earliestFinish<=planned))continue;
      for(const source of roots.get(parent.id)!){const reasons=waitingReasons.get(source)||new Set<string>();reasons.add(planned<=0?'后续工作已到计划开始日，仍在等待交付':'预计交付晚于后续计划开始');waitingReasons.set(source,reasons);}
    }
  }
  const risks: Record<string, PathRisk> = {};
  const eligibleIds=new Set(eligible.map(r=>r.id));
  for (const r of input.requirements) {
    const items = works.get(r.id)!, metrics = viewMetrics.get(r.id)!;
    const workNodes = items.map(w => byId.get(w.id)).filter((n): n is Internal => !!n);
    const reqNodes = [...nodes.filter(n=>n.kind==='milestone'&&n.requirementId===r.id),...workNodes, byId.get(startId(r.id))!, byId.get(acceptanceId(r.id))!];
    const key = reqNodes.some(n => global.critical.has(n.id));
    const fs = workNodes.flatMap(n => global.floats.has(n.id) && !n.complete ? [Math.min(global.floats.get(n.id)!,n.scheduleBuffer??Infinity)] : []);
    const blocked = reqNodes.some(n => (global.critical.has(n.id) || globalPlan.critical.has(n.id)) && (n.status === 'blocked' || waitingReasons.has(n.id) || n.unknownReasons.some(x => /验收|取消|解除|解阻|过期|已开始/.test(x))));
    let risk = metrics.riskLevel; const reasons: string[] = metrics.riskEvaluated && metrics.riskLevel !== 'low' ? [metrics.riskReason] : [];
    if (key||workNodes.some(n=>n.arrangement==='late'&&n.scheduleBuffer===0&&!n.complete)) { risk = risk === 'low' ? 'medium' : 'high'; reasons.push(key?'位于项目交付关键路径，余量为 0':'后置安排已用尽排期缓冲'); }
    else if (fs.some(f => f > 0 && f <= 2)) { if (risk === 'low') risk = 'medium'; reasons.push('临近关键路径，余量不超过 2 个工作日'); }
    if (blocked || reqNodes.some(n => lateDrivers.has(n.id))) { risk = 'high'; reasons.push(blocked ? '关键交付条件发生阻塞' : '位于预计延期目标的驱动路径'); }
    const complete = !byId.get(acceptanceId(r.id))!.unknownReasons.length;
    const ended = ['completed', 'cancelled'].includes(r.status);
    risks[r.id] = { riskLevel: ended ? 'low' : risk, riskEvaluated: !ended && (risk !== 'low' || metrics.riskEvaluated && complete),
      riskReason: reasons.join('；') || (!complete && risk === 'low' ? '交付条件待确认：' + byId.get(acceptanceId(r.id))!.unknownReasons.join('；') : metrics.riskReason),
      highRisk: !ended && risk === 'high', critical: key, criticalCount: workNodes.filter(n => n.kind==='work'&&global.critical.has(n.id)).length,
      minFloat: fs.length ? Math.min(...fs) : null, blockedCritical: blocked, complete,
      drivesLateTarget:reqNodes.some(n=>lateDrivers.has(n.id)),inDeliveryNetwork:reqNodes.some(n=>global.scope.has(n.id)) };
    const affected = new Set<string>(), seen=new Set(reqNodes.map(n=>n.id)), queue=[...seen];
    for(let i=0;i<queue.length;i++)for(const e of outgoing.get(queue[i])||[]){const child=byId.get(e.target)!;if(child.complete||acknowledged(child,e))continue;if(child.kind==='acceptance'&&eligibleIds.has(child.requirementId!))affected.add(child.requirementId!);if(!seen.has(child.id)){seen.add(child.id);queue.push(child.id);}}
    if(eligibleIds.has(r.id))affected.add(r.id);
    const anomalySince=[r.blockedAt,...items.filter(w=>w.status==='blocked').map(w=>w.blockedAt),...(metrics.delayed&&metrics.plannedEnd?[addBusinessDays(metrics.plannedEnd,1)]:[])].filter((d):d is string=>!!d).sort()[0]||null;
    Object.assign(risks[r.id],processingPriority({...r,...risks[r.id],anomalySince,affectedRequirementIds:[...affected]},input.asOfDate));
  }
  for (const n of nodes) {
    n.inScope = current.scope.has(n.id); n.critical = current.critical.has(n.id); n.planCritical = plan.critical.has(n.id);
    n.floatDays = n.complete ? null : current.floats.get(n.id) ?? null; n.nearCritical = n.floatDays !== null && n.floatDays > 0 && n.floatDays <= 2;
    n.riskLevel = n.requirementId ? risks[n.requirementId].riskLevel : n.kind==='milestone'&&!n.complete?(lateDrivers.has(n.id)||n.plannedEnd&&n.forecastEnd&&n.forecastEnd>n.plannedEnd||(global.critical.has(n.id)||globalPlan.critical.has(n.id))&&n.ownReasons.length?'high':global.critical.has(n.id)?'medium':'low'):'low';
  }
  edges.forEach(e => { e.critical = !acknowledged(byId.get(e.target)!,e) && current.critical.has(e.source) && current.critical.has(e.target) && byId.get(e.source)!.earliestFinish === byId.get(e.target)!.earliestStart; });
  const blockers: PathBlocker[] = [];
  const itemById = new Map([...works.values()].flat().map(w => [w.id, w]));
  for (const n of nodes) {
    if (!n.inScope || !n.requirementId&&n.kind!=='milestone' || n.complete || n.kind === 'start') continue;
    const w = itemById.get(n.id);
    const reasons = [...(waitingReasons.get(n.id)||[]), ...n.ownReasons.filter(x => x !== '依赖尚未核对' && x !== '预计工期缺失' && x !== '缺少有效工作项')];
    if (['work','execution'].includes(n.kind) && n.status === 'blocked') reasons.unshift(w?.blockedReason || '执行阻塞');
    // A predecessor that is late without a manual block is actionable only once its promise is missed.
    if (!reasons.length && n.plannedEnd && n.plannedEnd < input.asOfDate && ['work','execution'].includes(n.kind)) reasons.push('交付日期已过，工作尚未完成');
    if (!reasons.length) continue;
    const visited = new Set<string>([n.id]), queue = [n.id], affected = new Set<string>(), targets = new Set<string>();
    for (let i = 0; i < queue.length; i++) for (const e of outgoing.get(queue[i])!) {
      const child = byId.get(e.target)!; if (visited.has(child.id) || child.complete || acknowledged(child,e)) continue;
      visited.add(child.id); queue.push(child.id);
      if (child.requirementId && child.requirementId !== n.requirementId && !['completed', 'cancelled'].includes(reqById.get(child.requirementId)!.status)) affected.add(child.requirementId);
      if (child.kind === 'acceptance' || child.kind === 'project') targets.add(child.id);
    }
    blockers.push({ nodeId: n.id, requirementId: n.requirementId||'', workItemId: n.workItemId, title: n.title, ownerName: n.ownerName,
      reasons: [...new Set(reasons)], affectedRequirementIds: [...affected], targetCount: targets.size,
      critical: n.critical || n.planCritical, waitingDays: w?.blockedAt ? Math.max(0, businessDayDelta(w.blockedAt.slice(0, 10), input.asOfDate)) : 0, riskLevel: n.riskLevel });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  blockers.sort((a, b) => rank[a.riskLevel] - rank[b.riskLevel] || Number(b.critical) - Number(a.critical) || b.targetCount - a.targetCount || b.waitingDays - a.waitingDays || a.nodeId.localeCompare(b.nodeId));
  const target = byId.get(requestedTarget)!;
  const targetDate = requestedTarget === projectTarget ? input.projectEnd : target.plannedEnd;
  const unplanned = input.requirements.filter(r => !r.deletedAt && r.status === 'planning').length;
  const result=decorateForecastBasis(input,{ projectId: input.projectId, projectName: input.projectName, revision: input.revision, asOfDate: input.asOfDate, calendarVersion: 'chinese-days-1.5.9',
    target: requestedTarget, targetLabel: target.title, targetDate, forecastEnd: eligible.length || input.milestones?.some(m=>!m.requirementId&&!m.cancelled) || requestedTarget !== projectTarget ? target.forecastEnd : null,
    deadlineSlack: current.complete && (eligible.length || input.milestones?.some(m=>!m.requirementId&&!m.cancelled) || requestedTarget !== projectTarget) && targetDate ? toFinish(targetDate) - target.earliestFinish : null, complete: current.complete,
    coverage: { reviewed: input.requirements.filter(r => !r.deletedAt && r.dependenciesReviewedAt).length, total: input.requirements.filter(r => !r.deletedAt).length, unplanned },
    nodes: nodes.map(({ release: _r, fixed: _f, planDuration: _pd, planRelease: _pr, planFinish: _pf, planStart: _ps, actualStart: _as, ...n }) => n),
    edges, requirements: input.requirements.filter(r => !r.deletedAt).map(r=>({...r,...viewMetrics.get(r.id),executionStage:deriveExecutionStage({...r,status:viewMetrics.get(r.id)!.status},r.executionMode==='direct'?[]:works.get(r.id),(input.milestones||[]).filter(m=>m.requirementId===r.id)),...risks[r.id],processingPriority:risks[r.id].processingPriority,priorityReasons:risks[r.id].priorityReasons,affectedRequirementIds:risks[r.id].affectedRequirementIds,priorityAsOfDate:input.asOfDate})), dependencies: input.dependencies, risks, blockers,milestones:input.milestones||[],layouts:input.layouts||[] });

  return result;
}
