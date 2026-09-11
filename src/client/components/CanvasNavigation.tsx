import {ArrowLeft,ChevronRight} from 'lucide-react';
import type {ReactNode} from 'react';
import type {PathAnalysis} from '../../shared/paths';
import {canvasRoot,canvasView} from '../canvas-navigation';
import {ViewTabs} from './ViewTabs';
import {useWorkspaceRuntime} from '../workspace-runtime';
export function CanvasNavigation({params,data,onGo,onBack,extra}:{params:URLSearchParams;data:PathAnalysis;onGo:(url:string)=>void;onBack:()=>void;extra?:ReactNode}){
  const runtime=useWorkspaceRuntime(),view=canvasView(params),root=canvasRoot(params),featureId=params.get('featureId')||'ungrouped';
  const feature=data.featureContext?.overview.groups.find(g=>g.id===featureId),requirement=data.requirements.find(r=>r.id===params.get('requirementId'));
  const go=(url:string)=>{runtime.commitFields(false);onGo(url);};
  const trail:Array<{label:string;url?:string}>=[{label:root==='features'?'特性总览':'全部需求',url:'/paths?view='+root}];
  if(view==='feature'||view==='requirement'&&root==='features')trail.push({label:feature?.name||(featureId==='ungrouped'?'未归属需求':'特性已失效'),url:'/paths?view=feature&featureId='+encodeURIComponent(featureId)});
  if(view==='requirement')trail.push({label:requirement?.title||'需求工作项'});
  return <div className="canvas-navigation" data-workspace-zone="tools">
    <button className="ghost-button topbar-icon" title="返回上一画布" aria-label="返回上一画布" disabled={!window.history.state?.idx} onClick={()=>{runtime.commitFields(false);onBack();}}><ArrowLeft size={16}/></button>
    <ViewTabs ariaLabel="路径根视图" value={root} options={[{value:'features',label:'特性总览'},{value:'project',label:'全部需求'}]} onChange={value=>go('/paths?view='+value)}/>
    <nav aria-label="画布层级" className="canvas-breadcrumb">{trail.length>1&&trail.map((item,index)=><span key={index}>{index>0&&<ChevronRight size={14}/>} {index<trail.length-1?<button className="ghost-button" onClick={()=>go(item.url!)}>{item.label}</button>:<span aria-current="page" title={item.label}>{item.label}</span>}</span>)}</nav>
    <div className="canvas-navigation-actions">{extra}</div>
  </div>;
}
