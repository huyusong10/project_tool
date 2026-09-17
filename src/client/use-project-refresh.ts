import * as projectsApi from './features/projects/api';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { invalidateProjectViews } from './query-keys';
import { clearBusinessQueries } from './session-cache';

/** Other people's edits refresh query data; drafts and viewport remain owned by their existing sessions. */
export function useProjectRefresh(projectId:string,accountId:string,enabled:boolean) {
  const client=useQueryClient();
  useEffect(()=>{
    if(!enabled||!projectId||!accountId)return;
    const controller=new AbortController();let version:string|undefined,running=false,lastCheck=0;
    const check=async()=>{
      if(controller.signal.aborted||document.visibilityState==='hidden'||running||Date.now()-lastCheck<2000)return;
      running=true;lastCheck=Date.now();
      try{const result=await projectsApi.projectsChangeVersion<{version:string}>(projectId, {signal:controller.signal});
        if(controller.signal.aborted||typeof result.version!=='string')return;
        if(version!==undefined&&version!==result.version)invalidateProjectViews(client);
        version=result.version;
      }catch(error){if(!controller.signal.aborted&&error instanceof ApiError&&[401,403,404].includes(error.status)){clearBusinessQueries(client,true);invalidateProjectViews(client);}}
      finally{running=false;}
    };
    void check();const timer=setInterval(()=>void check(),60000);
    window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);
    return()=>{controller.abort();clearInterval(timer);window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check);};
  },[client,projectId,accountId,enabled]);
}
