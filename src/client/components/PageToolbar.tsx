import {useProjects,useSession} from '../app-context';
import {ProjectTaskTabs} from './ProjectTaskTabs';
import {isProjectWorkspace,projectTask,projectTaskUrl} from '../project-workspace-navigation';
import {useLayoutEffect,useRef,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {ArrowLeft,ChevronRight} from 'lucide-react';
import {usePageChrome,usePageChromeStore} from '../page-chrome';
import {useResolvedPage} from '../page-context';
import {useAppNavigate} from '../use-app-navigation';
import {usePageBack} from '../use-page-view';
import {WorkspaceRuntimeContext} from '../workspace-runtime';
import {TopbarMenu} from './TopbarMenu';
import './page-toolbar.css';

/** One page-level toolbar, including the loading and unavailable states. */
export function PageToolbar(){
  const page=useResolvedPage(),chrome=usePageChrome(),store=usePageChromeStore(),navigate=useAppNavigate(),location=useLocation();
  const {session}=useSession(),{selectedProjectId}=useProjects(),auxiliary=['/analytics','/actions'].includes(location.pathname);
  const returnToProgress=()=>navigate(projectTaskUrl(session.accountId||'guest',selectedProjectId,'progress'));
  const workspace=isProjectWorkspace(location.pathname);
  const params=new URLSearchParams(location.search),delivery=workspace&&projectTask(location.pathname)==='scope'&&!page.back,deepDelivery=delivery&&['feature','requirement','project'].includes(params.get('view')||'');
  const deliveryParent=params.get('view')==='requirement'&&params.get('featureId')?'/?view=feature&featureId='+encodeURIComponent(params.get('featureId')!):'/?view=features';
  const fallbackBack=usePageBack(page.back?.fallback||(delivery?deliveryParent:'/'));
  const root=useRef<HTMLDivElement>(null),[width,setWidth]=useState<number|null>(null);
  const visible=workspace||page.actionRow||!!page.back||page.phase==='error'||!!chrome?.views||!!chrome?.breadcrumbs?.length||!!chrome?.actions||!!chrome?.secondaryActions||!!chrome?.moreActions;
  useLayoutEffect(()=>{const element=root.current;if(!element)return;const measure=()=>setWidth(Math.round(element.getBoundingClientRect().width));const observer=new ResizeObserver(measure);observer.observe(element);measure();return()=>observer.disconnect();},[visible]);
  const ready=page.phase==='ready'&&!!chrome&&!chrome.titlePending,compact=width!==null&&width<960,narrow=width!==null&&width<640;
  const editor=page.toolbar==='path'||page.toolbar==='editor',secondaryInMenu=editor||compact;
  const hasMenu=!!(chrome?.moreActions||secondaryInMenu&&chrome?.secondaryActions||editor&&chrome?.context);
  const pendingEditorActions=editor&&<div className="page-editor-actions" aria-hidden="true"><div className="page-editor-history"/><div className="page-editor-primary"><span className="shell-placeholder toolbar-actions-placeholder"/></div></div>;
  const back=auxiliary?returnToProgress:ready&&chrome.onBack||((page.back||deepDelivery||page.phase==='error')?fallbackBack:undefined);
  const crumbs=auxiliary?[{label:'进展表',onClick:returnToProgress},{label:location.pathname==='/analytics'?'统计分析 · 全项目':'待处理事项 · 全项目'}]:ready&&chrome.breadcrumbs!==undefined?chrome.breadcrumbs:page.back?[{label:page.object?.kind==='template'?'流程设计':'需求清单',onClick:()=>navigate(page.back!.fallback)},{label:ready?chrome.title:page.phase==='error'?'无法打开':'',onClick:undefined}]:delivery?[{label:'项目特性',onClick:deepDelivery?()=>navigate('/?view=features'):undefined},...(deepDelivery?[{label:''}]:[])]:[];
  if(!visible)return null;
  return <WorkspaceRuntimeContext.Provider value={chrome?.runtime||null}>
    <div ref={root} className="page-toolbar" role="region" aria-label="页面工具栏" data-toolbar={page.toolbar} data-fixed-editor={editor} data-project-workspace={workspace} data-compact={compact} data-narrow={narrow} data-page-phase={page.phase} data-workspace-zone="tools" data-preserve-edit
      onClickCapture={event=>{if(chrome?.runtime?.requestSave&&(event.target as Element).closest('[aria-label="保存修改"]')){event.preventDefault();event.stopPropagation();chrome.runtime.requestSave();}}}
      onKeyDownCapture={event=>{if(chrome?.runtime?.requestSave&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();chrome.runtime.requestSave();}}}>
      {(back||crumbs.length>0)&&<div className="page-toolbar-location">
        <div className="page-toolbar-back-slot">{back&&<button type="button" className="page-back-button" aria-label={ready&&chrome.backLabel||page.back?.label||'返回'} title={ready&&chrome.backLabel||page.back?.label||'返回'} onClick={()=>{store.prepareNavigation();back();}}><ArrowLeft size={16}/></button>}</div>
        {!!crumbs.length&&<nav className="page-breadcrumb" aria-label={ready&&chrome.navigationLabel||'页面层级'}>{crumbs.map((crumb,index)=><span key={index}>{index>0&&<ChevronRight size={14} aria-hidden="true"/>}{crumb.onClick?<button type="button" title={crumb.label} onClick={()=>{store.prepareNavigation();crumb.onClick!();}}>{crumb.label}</button>:<span aria-current="page" title={crumb.label}>{crumb.label||<span className="shell-placeholder toolbar-location-placeholder" aria-label="正在加载对象名称"/>}</span>}</span>)}</nav>}
      </div>}
      {(workspace||ready&&chrome.views||delivery)&&<div className="page-toolbar-views">{workspace?<ProjectTaskTabs/>:ready&&chrome.views||<span className="shell-placeholder toolbar-views-placeholder" aria-hidden="true"/>}</div>}
      {ready&&chrome.context&&!editor&&<div className="page-toolbar-context">{chrome.context}</div>}
      {(ready&&chrome.status||editor)&&<div className="page-toolbar-status" role="status">{ready?chrome.status:<span className="shell-placeholder toolbar-status-placeholder" aria-hidden="true"/>}</div>}
      <div className="page-toolbar-actions">{ready?<>
        {!secondaryInMenu&&chrome.secondaryActions}{chrome.actions||pendingEditorActions}
        {!chrome.actions&&!chrome.secondaryActions&&!chrome.moreActions&&!chrome.views&&!crumbs.length&&<span className="toolbar-readonly">只读</span>}
      </>:pendingEditorActions||page.phase!=='error'&&<span className="shell-placeholder toolbar-actions-placeholder" aria-hidden="true"/>}
        <div className="page-toolbar-more-slot">{ready&&hasMenu&&<TopbarMenu label={chrome.moreLabel||'更多操作'} disabled={chrome.moreDisabled}>{editor&&chrome.context}{secondaryInMenu&&chrome.secondaryActions}{chrome.moreActions}</TopbarMenu>}</div>
      </div>
    </div>
  </WorkspaceRuntimeContext.Provider>;
}
