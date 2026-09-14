import {useQueryClient} from '@tanstack/react-query';
import {keys} from '../query-keys';
import type {Dashboard} from '../types';
import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {useProjects,useSession} from '../app-context';
import {useAppNavigate} from '../use-app-navigation';
import {usePageChromeStore} from '../page-chrome';
import {projectTask,projectTaskUrl,rememberProjectTask,type ProjectTask} from '../project-workspace-navigation';
import {ViewTabs} from './ViewTabs';

export function ProjectTaskTabs(){
  const location=useLocation(),navigate=useAppNavigate(),store=usePageChromeStore(),client=useQueryClient();
  const {session}=useSession(),{selectedProjectId}=useProjects();
  const account=session.accountId||'guest',project=selectedProjectId||'';
  useEffect(()=>rememberProjectTask(account,project,location.pathname,location.search),[account,project,location.pathname,location.search]);
  return <ViewTabs ariaLabel="项目任务" value={projectTask(location.pathname)} options={[{value:'scope',label:'范围与关系'},{value:'progress',label:'计划与进展'}]} onChange={async value=>{
    store.prepareNavigation();await store.getSnapshot()?.runtime?.document?.flush();
    const auxiliary=['/analytics','/actions'].includes(location.pathname);
    const context=new URLSearchParams(location.search),node=context.get('pathNode');
    const report=client.getQueryData<Dashboard>([...keys.dashboard,project]);
    if(location.pathname==='/execution'&&context.has('requirementId')){
      const requirement=report?.requirements.find(r=>r.id===context.get('requirementId'));
      if(requirement?.featureId){context.set('featureId',requirement.featureId);context.set('phaseId',requirement.phaseId||'unassigned');}
    }
    if(node?.startsWith('phase:')){
      const phaseId=node.slice(6),features=report?.featureOverview?.features;
      const feature=features?.find(f=>f.phases?.some(p=>p.id===phaseId)||node==='phase:'+f.id+':unassigned');
      if(feature){context.set('featureId',feature.id);context.set('pathNode','feature:'+feature.id);context.set('phaseId',phaseId.endsWith(':unassigned')?'unassigned':phaseId);}
    }
    navigate(projectTaskUrl(account,project,value as ProjectTask,auxiliary?undefined:context));
  }}/>;
}
