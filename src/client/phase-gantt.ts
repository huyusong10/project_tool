import {phaseCompletion, phaseProgress,type ProgressFact} from '../shared/feature-phases';
import type {WorkspaceRow} from './workspace-rows';
import {shortPhaseName} from './workspace-gantt-presentation';

type Fact = ProgressFact & {id:string; phaseId?:string|null; actualStart?:string|null; actualEnd?:string|null};

/** Parent rows summarize recorded execution, not an inferred Phase schedule. */
export function summaryTimeline(row:WorkspaceRow, asOfDate:string) {
  const phases = row.phase ? [row.phase] : row.virtual ? [] : row.feature?.phases || [];
  const facts = row.phase ? row.phase.requirements : [...row.feature?.requirements || [], ...phases.flatMap(p=>p.requirements)];
  const requirements = [...new Map<string,Fact>(facts.map(r=>[r.id,r])).values()].filter(r=>r.status!=='cancelled'&&(!row.virtual||!r.phaseId));
  const actual = phaseProgress(requirements,null,asOfDate);
  const completion = row.phase ? phaseCompletion(row.phase.requirements) : row.feature?.completion || phaseCompletion(requirements);
  const active = phases.filter(p=>p.status==='in_progress');
  const completed = [...phases].filter(p=>p.status==='completed').sort((a,b)=>a.sortOrder-b.sortOrder);
  const currentPhase=[...active].sort((a,b)=>a.sortOrder-b.sortOrder)[0] || completed.at(-1) || [...phases].filter(p=>phaseCompletion(p.requirements).total).sort((a,b)=>a.sortOrder-b.sortOrder)[0];
  const percent=completion.percent;
  const caption=!row.phase&&currentPhase ? shortPhaseName(currentPhase.name) : '';
  const parallelCount=Math.max(0,active.length-1);
  const label=percent===null||row.phase&&percent===0 ? '' : `${caption ? caption+' · ' : ''}${percent}%${parallelCount?' +'+parallelCount:''}`;
  return {asOfDate,actualStart:actual.actualStart,actualEnd:actual.observationEnd,
    status:row.phase ? row.phase.status : actual.status==='completed'?'in_progress':actual.status,
    completion,label,percent,caption,parallelCount,phases};
}
export type SummaryTimeline = ReturnType<typeof summaryTimeline>;

