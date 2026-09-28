import { useNavigate } from 'react-router-dom';
import { ViewTabs } from '../../components/ViewTabs';

export function JiraViewTabs({ projectId, value, disabled, onChange }: { projectId: string; value: 'progress' | 'discovery' | 'prs'; disabled?: boolean; onChange?: (view: 'progress' | 'discovery') => void }) {
  const navigate = useNavigate();
  return <ViewTabs ariaLabel="Jira 视图" className="jira-view-tabs" value={value} disabled={disabled} options={[{ value: 'progress', label: '需求进展' }, { value: 'discovery', label: '发现未纳入需求' }, { value: 'prs', label: 'PR' }]} onChange={view => {
    if (view !== 'prs' && onChange) onChange(view);
    else navigate((view === 'prs' ? '/jira/prs?' : '/jira?' + (view === 'discovery' ? 'view=discovery&' : '')) + 'projectId=' + projectId);
  }} />;
}
