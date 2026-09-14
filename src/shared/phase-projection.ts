import type {FeatureOverviewReport} from './feature-overview';
import type {PathRequirement} from './paths';
import {deriveExecutionStage} from './execution-stage';
import {phaseStatus,phaseDistribution,type PhaseRequirement} from './feature-phases';

/** Project draft membership onto delivery summaries; confirmed snapshots remain formal facts. */
export function projectPhaseOverview(report:FeatureOverviewReport,requirements:PathRequirement[]):FeatureOverviewReport{
  const current=new Map(requirements.map(r=>[r.id,r]));
  const fact=(r:PathRequirement):PhaseRequirement=>({...r,version:r.version||1,executionStage:r.executionStage||deriveExecutionStage(r)});
  return {...report,features:report.features.map(f=>{
    const assigned=requirements.filter(r=>r.featureId===f.id);
    return {...f,unassignedPhaseCount:assigned.filter(r=>!r.phaseId&&!r.deletedAt&&r.status!=='cancelled').length,phases:f.phases?.map(p=>{
      const archived=p.requirements.filter(r=>r.deletedAt&&!current.has(r.id)),members=[...archived,...assigned.filter(r=>r.phaseId===p.id).map(fact)];
      return {...p,requirements:members,status:phaseStatus(members,p.deliveredAt),distribution:phaseDistribution(members)};
    })};
  })};
}
