import {useState,useRef,type ReactNode} from 'react';
import type {PageChrome} from '../page-chrome';
import { PageHeader } from './PageHeader';
import {useWorkspaceLayer} from '../workspace-runtime';
import {Undo2,Redo2,Save,Pencil,X,Plus,Square,Diamond,Workflow,Search,Info} from 'lucide-react';
function ToolMenu({label,icon,children,className}:{label:string;icon:ReactNode;children:ReactNode;className:string}){
  const ref=useRef<HTMLDetailsElement>(null),[open,setOpen]=useState(false);
  useWorkspaceLayer(ref,open,'menu',()=>{if(ref.current)ref.current.open=false;});

  return <details ref={ref} className={className} onToggle={e=>setOpen(e.currentTarget.open)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(ref.current){ref.current.open=false;ref.current.querySelector<HTMLElement>('summary')?.focus();}}}}><summary aria-label={label} title={label}>{icon}</summary>{children}</details>;
}
export function EditorToolbar({title,back,backLabel,pageNavigation,secondaryActions,context,status,editing,canEdit=true,undo,redo,canUndo,canRedo,save,canSave=true,discard,begin,busy,extra}:{title:string;pageNavigation?:Pick<PageChrome,'breadcrumbs'|'navigationLabel'|'views'|'onBack'|'backLabel'>;secondaryActions?:ReactNode;back?:()=>void;backLabel?:string;context?:ReactNode;status?:ReactNode;editing:boolean;canEdit?:boolean;undo?:()=>void;redo?:()=>void;canUndo?:boolean;canRedo?:boolean;save?:()=>void;canSave?:boolean;discard?:()=>void;begin?:()=>void;busy?:boolean;extra?:ReactNode}){
  return <PageHeader {...pageNavigation} title={title} onBack={back||pageNavigation?.onBack} backLabel={backLabel||pageNavigation?.backLabel} secondaryActions={secondaryActions} context={context} status={status}
    moreActions={(extra||editing)?<>{extra}{editing&&<button className="ghost-button" aria-label="放弃修改" disabled={busy} onClick={discard}><X size={17}/>放弃修改</button>}</>:undefined}
    actions={<div className="page-editor-actions"><div className="page-editor-history">{editing&&<>
      <button className="ghost-button topbar-icon" title="撤销 · Ctrl/Cmd+Z" aria-label="撤销" disabled={!canUndo||busy} onClick={undo}><Undo2 size={17}/></button>
      <button className="ghost-button topbar-icon" title="重做 · Ctrl/Cmd+Shift+Z" aria-label="重做" disabled={!canRedo||busy} onClick={redo}><Redo2 size={17}/></button>
    </>}</div><div className="page-editor-primary">{editing?<button className="primary-button" title={busy?'保存中…':'保存 · Ctrl/Cmd+S'} aria-label="保存修改" disabled={!canSave||busy} onClick={save}><Save size={17}/><span>保存</span></button>
    :canEdit&&<button className="primary-button" title="编辑画布" aria-label="编辑画布" disabled={busy} onClick={begin}><Pencil size={17}/><span>编辑</span></button>}</div></div>}/>;
}
const elementLabels:Record<string,string>={requirement:'需求',work:'工作项',milestone:'里程碑',existing:'已有对象'};
export function EditorPalette({types,placing,onPlace,disabled}:{types:string[];placing?:string;onPlace:(kind:string)=>void;disabled?:boolean}){
  return <ToolMenu className="graph-element-menu" label="添加元素" icon={<Plus size={18}/>}><div className="graph-elements"><strong>拖入画布，或点击后放置</strong>{types.map(type=>{const Icon=type==='existing'?Search:type==='requirement'?Workflow:type==='milestone'?Diamond:Square;return <button key={type} draggable={!disabled&&type!=='existing'} disabled={disabled} className={placing===type?'selected':''} onDragEnd={e=>{onPlace('');e.currentTarget.closest('details')?.removeAttribute('open');}} onDragStart={e=>{onPlace(type);e.dataTransfer.setData('application/pm-element',type);e.dataTransfer.effectAllowed='copy';}} onClick={e=>{onPlace(placing===type?'':type);e.currentTarget.closest('details')?.removeAttribute('open');}}><Icon size={20}/>{elementLabels[type]}</button>;})}</div></ToolMenu>;
}
export function FindTool({onClick}:{onClick:()=>void}){return <button className="ghost-button" aria-label="查找与筛选" title="查找与筛选 · Ctrl/Cmd+F" onClick={onClick}><Search size={18}/></button>;}
export function EditorInfo({onClick}:{onClick:()=>void}){return <button className="ghost-button" aria-label="分析说明" title="分析说明" onClick={onClick}><Info size={17}/></button>;}
