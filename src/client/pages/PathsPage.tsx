import { PageHeader } from '../components/PageHeader';
import { PathAnalysisPanel } from '../components/PathAnalysisPanel';
import { useProjects } from '../app-context';
export function PathsPage(){const {selectedProjectId}=useProjects();return <><PageHeader title="路径分析"/><PathAnalysisPanel key={selectedProjectId} projectId={selectedProjectId}/></>;}
