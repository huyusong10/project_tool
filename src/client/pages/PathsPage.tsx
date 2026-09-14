import {RequirementsPage} from './RequirementsPage';
import { PathAnalysisPanel } from '../components/PathAnalysisPanel';
import { FeaturePathPanel } from '../components/FeaturePathPanel';
import { useProjects,useSession } from '../app-context';
import {Navigate,useSearchParams,useLocation} from 'react-router-dom';
import {useEffect,useRef} from 'react';
import {canvasView} from '../canvas-navigation';
import {initialScopeMode} from '../project-workspace-navigation';
export function PathsPage(){
  const location=useLocation();
  const {selectedProjectId}=useProjects(),{session}=useSession(),[params,setParams]=useSearchParams(),key=(session.accountId||'guest')+':'+selectedProjectId,previous=useRef(key);
  useEffect(()=>{if(previous.current!==key){previous.current=key;setParams({view:'features'},{replace:true});}},[key,setParams]);
  if(previous.current!==key)return null;
  if(location.pathname==='/requirements'){const next=new URLSearchParams(params);next.set('view','project');next.set('mode','table');next.set('intake','1');return <Navigate to={'/?'+next} replace state={location.state}/>;}
  if(params.get('intake')==='1')return <RequirementsPage key={key}/>;
  if(location.pathname!=='/'||!params.has('view')||!params.has('mode')){const next=new URLSearchParams(params);next.set('view',location.pathname==='/features'?'features':location.pathname==='/'&&!params.has('view')&&!params.has('pathScope')&&!params.has('pathRelation')&&!params.has('pathNode')?'features':canvasView(params));if(!next.has('mode'))next.set('mode',location.pathname==='/features'?'table':location.pathname==='/'?initialScopeMode(session.accountId||'guest',selectedProjectId):'graph');if(next.has('feature')){next.set('pathNode','feature:'+next.get('feature'));next.delete('feature');next.set('pathInspector','open');}return <Navigate to={'/?'+next} replace state={location.state}/>;}
  return canvasView(params)==='features'?<FeaturePathPanel key={key} projectId={selectedProjectId}/>:<PathAnalysisPanel key={key} projectId={selectedProjectId}/>;
}
