import {useIsMutating} from '@tanstack/react-query';
import {Button} from './Button';
import {ArrowLeft, ArrowUpRight} from 'lucide-react';
import type {ReactNode} from 'react';
import {Modal} from './Modal';
import {ObjectDetailContext} from './ObjectDetailContext';
import {useSession} from '../app-context';
import './object-inspector.css';

/** Compatibility entry; every object uses the same centered detail shell. */
export function ObjectInspector({title,identity,kind,status,links,projectId='',tab,onTabChange,onClose,onEnter,onBack,backLabel,children,hidden=false}:{hidden?:boolean;title:string;identity:string;kind?:string;status?:ReactNode;links?:ReactNode;projectId?:string;tab?:string;onTabChange?:(tab:string)=>void;onClose:()=>void;onEnter?:()=>void;onBack?:()=>void;backLabel?:string;children:ReactNode}){
  const {session}=useSession(), busy=useIsMutating()>0;
  if(hidden)return null;
  return <ObjectDetailContext.Provider value={{key:`pm-object-detail:${session.accountId||'guest'}:${projectId}:${identity}`,tab,onTabChange}}>
    <Modal title={title} width={960} layout="workspace" closable={!busy} onClose={onClose}
      backAction={onBack&&<Button variant="ghost" iconOnly disabled={busy} aria-label={'返回'+(backLabel||'上个对象')} title={'返回'+(backLabel||'上个对象')} onClick={onBack}><ArrowLeft size={18}/></Button>}
      headerActions={<>{links}{kind&&<span className="object-detail-kind">{kind}</span>}{status}{onEnter&&<Button variant="ghost" iconOnly disabled={busy} aria-label={'进入'+(kind==='工作项'?'需求':kind==='归类'?'特性':kind||'工作区')} title={'进入'+(kind==='工作项'?'需求':kind==='归类'?'特性':kind||'工作区')} onClick={onEnter}><ArrowUpRight size={17}/></Button>}</>}>
      {children}
    </Modal>
  </ObjectDetailContext.Provider>;
}
