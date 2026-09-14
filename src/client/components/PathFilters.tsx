import {useIntake} from './RequirementIntake';
import {useProjects} from '../app-context';
import {requirementStatusLabels,riskLabels} from '../../shared/domain';
import {emptyRequirementFilters,unfinishedStatuses,type RequirementFilters} from '../../shared/requirement-view';
export function PathFilters({value,onChange,owners,people,personId,internal}:{value:RequirementFilters;onChange:(f:RequirementFilters)=>void;owners:Array<{id:string;title:string}>;people:Array<{id:string;title:string}>;personId:string|null;internal:boolean}){
  const {selectedProjectId}=useProjects(),intake=useIntake(selectedProjectId);
  const preset=(id:string)=>{const f=emptyRequirementFilters();if(id==='unfinished')f.statuses=[...unfinishedStatuses];if(id==='in_progress')f.statuses=[id];if(id==='high'){f.statuses=[...unfinishedStatuses];f.risks=['high'];}if(id==='mine'&&personId){f.statuses=[...unfinishedStatuses];if(internal)f.participants=[personId];else f.owners=[personId];}onChange(f);};
  const groups=[{key:'features',label:'特性',options:[['unassigned','未关联特性'],...(intake.data?.features.map(g=>[g.id,g.name])||[])]},{key:'statuses',label:'状态',options:Object.entries(requirementStatusLabels)},{key:'risks',label:'风险',options:[...Object.entries(riskLabels),['pending','待评估']]},{key:'owners',label:internal?'工作项负责人':'需求负责人',options:owners.map(p=>[p.id,p.title])},{key:'participants',label:'执行人员',options:people.map(p=>[p.id,p.title])},{key:'schedule',label:'排期',options:[['delayed','延期'],['unplanned','未排期'],['on_track','计划正常']]}] as const;
  return <div className="path-filter-options"><div className="graph-filter-presets">{[['unfinished','未结束'],['in_progress','进行中'],['high','高风险'],['mine','我负责'],['all','全部']].map(([id,label])=><button className="ghost-button" key={id} disabled={id==='mine'&&!personId} onClick={()=>preset(id)}>{label}</button>)}</div>
    {groups.map(g=><fieldset key={g.key}><legend>{g.label}</legend><div>{g.options.map(([id,label])=><label key={id}><input type="checkbox" checked={(value[g.key]||[]).includes(id)} onChange={()=>onChange({...value,[g.key]:(value[g.key]||[]).includes(id)?(value[g.key]||[]).filter(v=>v!==id):[...value[g.key]||[],id]})}/>{label}</label>)}</div></fieldset>)}
    <label><input type="checkbox" checked={value.critical} onChange={e=>onChange({...value,critical:e.target.checked})}/>关键路径</label>
    {value.attention&&<label><input type="checkbox" checked onChange={()=>onChange({...value,attention:false})}/>关键与异常（历史条件）</label>}
  </div>;
}
