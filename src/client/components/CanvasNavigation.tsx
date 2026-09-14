import {ArrowLeft,ChevronRight} from 'lucide-react';
import type {ReactNode} from 'react';
import type {PathAnalysis} from '../../shared/paths';
import {canvasRoot,canvasView} from '../canvas-navigation';
import {ViewTabs} from './ViewTabs';
import {useWorkspaceRuntime} from '../workspace-runtime';
export function CanvasNavigation({params,data,onGo,onBack,extra}:{params:URLSearchParams;data:PathAnalysis;onGo:(url:string)=>void;onBack:()=>void;extra?:ReactNode}){
  const runtime=useWorkspaceRuntime(),view=canvasView(params),root=canvasRoot(params),featureId=params.get('featureId')||'unassigned';
  const feature=data.featureContext?.overview.features.find(g=>g.id===featureId),requirement=data.requirements.find(r=>r.id===params.get('requirementId'));
  const go=(url:string)=>{runtime.commitFields(false);onGo(url);};
  const trail:Array<{label:string;url?:string}>=[{label:root==='features'?'项目特性':'全部需求',url:'/paths?view='+root}];
  if(view==='feature'||view==='requirement'&&root==='features')trail.push({label:feature?.name||(featureId==='unassigned'?'未关联特性需求':'特性已失效'),url:'/paths?view=feature&featureId='+encodeURIComponent(featureId)});
  if(view==='requirement')trail.push({label:requirement?.title||'需求工作项'});
  return <div className="canvas-navigation" data-workspace-zone="tools">
    <button className="ghost-button topbar-icon" title="返回上一范围" aria-label="返回上一画布" disabled={!window.history.state?.idx} onClick={()=>{runtime.commitFields(false);onBack();}}><ArrowLeft size={16}/></button>
    <ViewTabs ariaLabel="交付范围" value={root} options={[{value:'features',label:'项目特性'},{value:'project',label:'全部需求'}]} onChange={value=>go('/paths?view='+value)}/>
    <nav aria-label="交付层级" className="canvas-breadcrumb">{trail.length>1&&trail.map((item,index)=><span key={index}>{index>0&&<ChevronRight size={14}/>} {index<trail.length-1?<button className="ghost-button" onClick={()=>go(item.url!)}>{item.label}</button>:<span aria-current="page" title={item.label}>{item.label}</span>}</span>)}</nav>
    <div className="canvas-navigation-actions"><ViewTabs ariaLabel="交付视图" value={params.get('mode')||'table'} options={[{value:'table',label:'表格'},{value:'graph',label:'关系图'}]} onChange={mode=>{const next=new URLSearchParams(params);next.set('mode',mode);go('/?'+next);}}/>{params.get('mode')==='graph'&&extra}</div>
  </div>;
}
