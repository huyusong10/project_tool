import { PathAnalysisPanel } from '../components/PathAnalysisPanel';
import { FeaturePathPanel } from '../components/FeaturePathPanel';
import { useProjects,useSession } from '../app-context';
import {Navigate,useSearchParams} from 'react-router-dom';
import {useEffect,useRef} from 'react';
import {canvasView} from '../canvas-navigation';
export function PathsPage(){
  const {selectedProjectId}=useProjects(),{session}=useSession(),[params,setParams]=useSearchParams(),key=(session.accountId||'guest')+':'+selectedProjectId,previous=useRef(key);
  useEffect(()=>{if(previous.current!==key){previous.current=key;setParams({view:'features'},{replace:true});}},[key,setParams]);
  if(previous.current!==key)return null;
  if(!params.has('view')){const next=new URLSearchParams(params);next.set('view',canvasView(params));return <Navigate to={'/paths?'+next} replace/>;}
  return canvasView(params)==='features'?<FeaturePathPanel key={key} projectId={selectedProjectId}/>:<PathAnalysisPanel key={key} projectId={selectedProjectId}/>;
}
