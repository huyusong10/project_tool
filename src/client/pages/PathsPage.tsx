import { PathAnalysisPanel } from '../components/PathAnalysisPanel';
import { FeaturePathPanel } from '../components/FeaturePathPanel';
import { useProjects,useSession } from '../app-context';
import { Link,useSearchParams } from 'react-router-dom';
export function PathsPage(){const {selectedProjectId}=useProjects(),{session}=useSession(),[params]=useSearchParams();const legacy=params.get('view')==='project'||['pathNode','pathEdge','pathRelation','pathScope'].some(key=>params.has(key));return legacy?<><div className="feature-path-bar"><Link to="/paths">特性关系图</Link><span>› 全部需求</span></div><PathAnalysisPanel key={(session.accountId||'guest')+selectedProjectId} projectId={selectedProjectId}/></>:<FeaturePathPanel key={(session.accountId||'guest')+selectedProjectId} projectId={selectedProjectId}/>;}
