import { PathAnalysisPanel } from '../components/PathAnalysisPanel';
import { useProjects } from '../app-context';
export function PathsPage(){const {selectedProjectId}=useProjects();return <PathAnalysisPanel key={selectedProjectId} projectId={selectedProjectId}/>;}
