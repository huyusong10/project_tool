import {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {useProjects,useSession} from '../app-context';
import {useAppNavigate} from '../use-app-navigation';
import {usePageChromeStore} from '../page-chrome';
import {projectTask,projectTaskUrl,rememberProjectTask,type ProjectTask} from '../project-workspace-navigation';
import {ViewTabs} from './ViewTabs';

export function ProjectTaskTabs(){
  const location=useLocation(),navigate=useAppNavigate(),store=usePageChromeStore();
  const {session}=useSession(),{selectedProjectId}=useProjects();
  const account=session.accountId||'guest',project=selectedProjectId||'';
  useEffect(()=>rememberProjectTask(account,project,location.pathname,location.search),[account,project,location.pathname,location.search]);
  return <ViewTabs ariaLabel="项目任务" value={projectTask(location.pathname)} options={[{value:'scope',label:'范围与关系'},{value:'progress',label:'计划与进展'}]} onChange={async value=>{
    store.prepareNavigation();await store.getSnapshot()?.runtime?.document?.flush();
    const auxiliary=['/analytics','/actions'].includes(location.pathname);
    navigate(projectTaskUrl(account,project,value as ProjectTask,auxiliary?undefined:new URLSearchParams(location.search)));
  }}/>;
}
