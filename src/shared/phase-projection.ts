import type {FeatureOverviewReport} from './feature-overview';
import type {PathRequirement} from './paths';
import {deriveExecutionStage} from './execution-stage';
import {phaseProgress,phaseDistribution,type PhaseRequirement} from './feature-phases';

export function projectRequirementFacts(report:FeatureOverviewReport,requirements:PathRequirement[]):Array<PathRequirement&PhaseRequirement>{
  const recorded=new Map(report.features.flatMap(f=>[...f.requirements,...f.phases?.flatMap(p=>p.requirements)||[]]).map(r=>[r.id,r]));
  return requirements.map(r=>{
    const saved=recorded.get(r.id);
    // Work-based requirements keep their aggregated execution facts; graph rows
    // carry raw requirement dates, which may be null even after completion.
    return {...saved,...r,progress:saved?.progress??r.progress,actualStart:saved?saved.actualStart:r.actualStart,actualEnd:saved?saved.actualEnd:r.actualEnd,version:r.version||1,executionStage:r.executionStage||deriveExecutionStage(r)};
  });
}
/** Project draft membership onto delivery summaries; confirmed snapshots remain formal facts. */
export function projectPhaseOverview(report:FeatureOverviewReport,requirements:PathRequirement[]):FeatureOverviewReport{
  const facts=projectRequirementFacts(report,requirements),current=new Map(facts.map(r=>[r.id,r]));
  return {...report,features:report.features.map(f=>{
    const assigned=facts.filter(r=>r.featureId===f.id);
    return {...f,unassignedPhaseCount:assigned.filter(r=>!r.phaseId&&!r.deletedAt&&r.status!=='cancelled').length,phases:f.phases?.map(p=>{
      const archived=p.requirements.filter(r=>r.deletedAt&&!current.has(r.id)),members=[...archived,...assigned.filter(r=>r.phaseId===p.id)];
      return {...p,requirements:members,...phaseProgress(members,p.targetDate,report.asOfDate),distribution:phaseDistribution(members)};
    })};
  })};
}
