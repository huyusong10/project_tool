import { Check, ChevronRight, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ImportReceipt, IntakePackage } from '../../shared/intake';
import { useListPagination } from '../use-list-pagination';
import { usePageSearchParams } from '../use-page-view';
import { Button, ButtonLink } from './Button';
import { Pagination } from './Pagination';
import { SearchInput } from './SearchInput';

export function RequirementImportResult({ result, pkg, projectId, onContinue }: {
  result: Extract<ImportReceipt, { status: 'applied' }>;
  pkg: IntakePackage | null;
  projectId: string;
  onContinue: () => void;
}) {
  const [params, setParams] = usePageSearchParams(['intakeResult.q']);
  const query = params.get('intakeResult.q') || '';
  const drafts = new Map(pkg?.requirements.map(requirement => [requirement.key, requirement]));
  const entries = Object.entries(result.requirementIds).map(([key, id]) => ({ key, id, title: drafts.get(key)?.title || key, action: drafts.get(key)?.action }));
  const filtered = entries.filter(entry => entry.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const pages = useListPagination({ items: filtered, id: 'intakeResult', defaultPageSize: 10, filterKey: result.batchId + ':' + query });
  const projectList = '/?' + new URLSearchParams({ projectId, workspaceView: 'list', scopeType: 'project', scopeId: projectId });
  const search = (value: string) => setParams(current => {
    const next = new URLSearchParams(current);
    if (value) next.set('intakeResult.q', value); else next.delete('intakeResult.q');
    next.delete('intakeResult.page');
    return next;
  });
  const continueImport = () => {
    setParams(current => {
      const next = new URLSearchParams(current);
      for (const key of ['intakeResult.q', 'intakeResult.page', 'intakeResult.pageSize']) next.delete(key);
      return next;
    });
    onContinue();
  };
  return <section className="intake-result" aria-label="导入结果">
    <header className="intake-result-summary">
      <span className="intake-result-check"><Check size={24} aria-hidden="true" /></span>
      <div className="intake-result-message">
        <h2>导入完成</h2>
        <p className="intake-result-count">已保存 {entries.length} 个需求</p>
        <p>打开需求核对详情，或前往项目清单继续安排工作。</p>
      </div>
      <div className="intake-result-actions">
        <ButtonLink variant="primary" to={projectList}>查看项目清单</ButtonLink>
        <Button variant="secondary" onClick={continueImport}>继续导入</Button>
      </div>
    </header>
    <section className="intake-result-list" aria-label="本次保存的需求">
      <header className="intake-result-toolbar">
        <h3>本次保存的需求 <span>{entries.length}</span></h3>
        {(entries.length > 10 || query) && <SearchInput value={query} onChange={search} placeholder="搜索本批次需求" />}
      </header>
      <div className="intake-result-body" ref={pages.scrollRef}>
        {filtered.length ? <ul>{pages.items.map(entry => <li key={entry.key}>
          <Link className="intake-result-row" to={'/requirements/' + entry.id} aria-label={entry.title}>
            <FileText size={17} aria-hidden="true" />
            <span className="intake-result-title">{entry.title}</span>
            {entry.action !== 'skip' && entry.action && <span className="intake-result-action">{entry.action === 'update' ? '更新' : '新增'}</span>}
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        </li>)}</ul> : <div className="intake-result-empty">
          <p>{query ? '没有找到匹配的需求' : '本批次没有保存需求'}</p>
          {query && <Button variant="link" onClick={() => search('')}>清除搜索</Button>}
        </div>}
      </div>
      {entries.length > 10 && <Pagination {...pages.props} label="导入结果分页" />}
    </section>
  </section>;
}
