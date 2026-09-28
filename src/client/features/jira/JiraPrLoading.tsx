import { Plus, RefreshCw, Send } from 'lucide-react';
import { AdaptiveDataList, type AdaptiveDataColumn } from '../../components/AdaptiveDataList';
import { Button } from '../../components/Button';
import { LoadingState } from '../../components/Feedback';
import { FilterBar } from '../../components/FilterBar';
import { FormError } from '../../components/Form';
import { PageHeader } from '../../components/PageHeader';
import { SearchInput } from '../../components/SearchInput';
import { Select } from '../../components/Select';
import { JiraViewTabs } from './JiraViewTabs';

export const jiraPrColumns: AdaptiveDataColumn[] = [
  { key: 'item', label: '需求 / Feature / Phase', track: 'minmax(220px, 2fr)', compact: 'primary' },
  { key: 'local', label: '本地状态', track: '120px' },
  { key: 'remote', label: 'Jira 当前状态', track: 'minmax(130px, 1fr)' },
  { key: 'target', label: '本次同步到', track: 'minmax(160px, 1fr)' },
  { key: 'comments', label: '评论 / 处理情况', track: '120px' },
];

export function JiraPrLoading({ projectId, error, onRetry }: { projectId: string; error?: string; onRetry?: () => void }) {
  return <>
    <PageHeader title="Jira PR" actions={<Button variant="primary" disabled><Send size={16} />推送到 Jira</Button>}
      secondaryActions={<Button disabled><RefreshCw size={15} />更新草稿</Button>} />
    <div className="page-content jira-pr-page" aria-busy={!error}>
      <JiraViewTabs projectId={projectId} value="prs" />
      <div className="jira-pr-summary jira-pr-workspace-summary"><span>{error ? 'PR 暂时无法读取' : '正在读取 PR'}</span></div>
      <FilterBar className="jira-pr-filters" result="读取中">
        <SearchInput aria-label="搜索 PR 事项" placeholder="需求、Jira 编号" value="" onChange={() => {}} disabled />
        {['Feature', 'Phase', '处理情况'].map(label => <Select key={label} aria-label={'PR ' + label} disabled><option>{label === '处理情况' ? '全部需求' : '全部 ' + label}</option></Select>)}
        <Button disabled><Plus size={15} />添加需求与评论</Button>
      </FilterBar>
      <AdaptiveDataList label="PR 变更清单" columns={jiraPrColumns} className="jira-pr-changes paged-panel">
        <div className="jira-pr-loading-content">{error ? <><FormError>{error}</FormError><Button onClick={onRetry}><RefreshCw size={15} />重新读取</Button></> : <LoadingState label="正在读取 PR 内容…" />}</div>
      </AdaptiveDataList>
    </div>
  </>;
}
