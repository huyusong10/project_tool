import {useLayoutEffect,useRef} from 'react';
import {useLocation,useNavigate,useNavigationType} from 'react-router-dom';

export type PageReturnSource={account:string;projectId:string;url:string;index:number};
export function pageReturnScope(pathname:string,search:string){
  const params=new URLSearchParams(search);
  if(['/','/paths','/features'].includes(pathname))return ['delivery',params.get('view')||'features',params.get('featureId')||'',params.get('requirementId')||''].join(':');
  if(pathname==='/templates')return pathname+':'+(params.get('edit')||'');
  return pathname;
}
export function validPageReturn(source:PageReturnSource|undefined,account:string,index:number,projects:string[]){
  return !!source&&source.account===account&&Number.isInteger(source.index)&&source.index>=0&&source.index<index&&typeof source.url==='string'&&source.url.startsWith('/')&&!source.url.startsWith('//')&&typeof source.projectId==='string'&&(!source.projectId||projects.includes(source.projectId));
}
/** Attach one origin to the router entry; view/filter changes retain that origin. */
export function usePageReturnSource(account:string,projectId:string){
  const location=useLocation(),action=useNavigationType(),navigate=useNavigate();
  const scope=pageReturnScope(location.pathname,location.search),index=window.history.state?.idx||0;
  const prior=useRef<{account:string;scope:string;projectId:string;url:string;index:number;source?:PageReturnSource}|null>(null);
  useLayoutEffect(()=>{
    const previous=prior.current;let source=location.state?.pageReturn as PageReturnSource|undefined;
    if(previous?.account===account&&action!=='POP'){
      if(action==='PUSH'&&previous.scope!==scope)source={account,projectId:previous.projectId,url:previous.url,index:previous.index};
      else if(previous.scope===scope&&!source)source=previous.source;
    }
    prior.current={account,scope,projectId,url:location.pathname+location.search,index,source};
    if(source&&JSON.stringify(source)!==JSON.stringify(location.state?.pageReturn))navigate(location.pathname+location.search,{replace:true,state:{...location.state,pageReturn:source}});
  },[account,projectId,scope,index,action,location,navigate]);
}
