import type {PathAnalysis} from '../../shared/paths';
import type {PageChrome} from '../page-chrome';
import {canvasView} from '../canvas-navigation';
export function canvasNavigation({params,data,onGo,onBack}:{params:URLSearchParams;data:PathAnalysis;onGo:(url:string)=>void;onBack:(fallback:string)=>void}):Pick<PageChrome,'breadcrumbs'|'navigationLabel'|'views'|'onBack'|'backLabel'>{
  const view=canvasView(params),featureId=params.get('featureId')||data.requirements.find(r=>r.id===params.get('requirementId'))?.featureId||'unassigned';
  const feature=data.featureContext?.overview.features.find(g=>g.id===featureId),requirement=data.requirements.find(r=>r.id===params.get('requirementId'));
  const trail:Array<{label:string;url?:string}>=[{label:'项目特性',url:'/?view=features'}];
  if(view==='project')trail.push({label:'需求检索'});
  if(view==='feature'||view==='requirement')trail.push({label:feature?.name||(featureId==='unassigned'?'其他特性':'特性已失效'),url:'/?view=feature&featureId='+encodeURIComponent(featureId)});
  if(view==='requirement')trail.push({label:requirement?.title||'需求工作项'});
  return {breadcrumbs:trail.map((item,index)=>({label:item.label,onClick:index<trail.length-1&&item.url?()=>onGo(item.url!):undefined})),navigationLabel:'交付层级',backLabel:'返回上一画布',onBack:view==='features'?undefined:()=>onBack(trail.at(-2)?.url||'/?view=features'),
    };
}
