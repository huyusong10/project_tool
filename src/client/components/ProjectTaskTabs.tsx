import {useLocation} from 'react-router-dom';
import {useProjects,useSession} from '../app-context';
import {useAppNavigate} from '../use-app-navigation';
import {readWorkspaceLocation,workspaceParams,workspacePreferenceKey,type WorkspaceLocation,type WorkspaceView} from '../workspace-location';
import {ViewTabs} from './ViewTabs';

export function ProjectTaskTabs(){
  const url=useLocation(),navigate=useAppNavigate(),{session}=useSession(),{selectedProjectId}=useProjects();
  let location=readWorkspaceLocation(new URLSearchParams(url.search),selectedProjectId,url.pathname);
  if(['/analytics','/actions'].includes(url.pathname))try{const saved=JSON.parse(localStorage.getItem(workspacePreferenceKey(session.accountId||'guest',selectedProjectId))||'null') as WorkspaceLocation|null;if(saved?.projectId===selectedProjectId)location=saved;}catch{/* No saved workspace. */}
  return <ViewTabs ariaLabel="项目视角" value={location.view} options={[{value:'list',label:'特性清单'},{value:'graph',label:'关系图'},{value:'progress',label:'进展表'}]} onChange={view=>navigate('/?'+workspaceParams({...location,view:view as WorkspaceView}))}/>;
}
