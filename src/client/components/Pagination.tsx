import { Button } from './Button';
import {Select} from './Select';
import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageNumbers, pageRange, pageSizeOptions as defaultOptions } from '../pagination';
import { useInlineEditActive } from './InlineEdit';
import './pagination.css';

export type PaginationProps = {
  page: number; pageSize: number; total: number;
  onPageChange: (page: number) => void; onPageSizeChange: (size: number) => void;
  loading?: boolean; disabled?: boolean; pageSizeOptions?: number[]; className?: string; label?: string;
};
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, loading = false,
  disabled = false, pageSizeOptions = defaultOptions, className = '', label = '列表分页',
}: PaginationProps) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const inlineActive = useInlineEditActive(container);
  const blocked = disabled || loading || inlineActive;
  const range = pageRange(total, page, pageSize);
  return <footer ref={setContainer} className={`table-pagination ${className}`.trim()} aria-busy={loading}>
    <nav className="pagination-content" aria-label={label}>
      <div className="pagination-summary">
        <span aria-live="polite">{total ? <><span className="pagination-range">第 {range.start + 1}–{range.end} 条，</span>共 {total} 条</> : '共 0 条'}</span>
        <Select aria-label="每页数量" value={pageSize} disabled={blocked} onChange={event => onPageSizeChange(Number(event.target.value))}>{pageSizeOptions.map(size => <option key={size} value={size}>{size} 条/页</option>)}</Select>
      </div>
      {range.pages > 1 && <div className="pagination-controls">
        <Button variant="secondary" type="button" aria-label="上一页" title="上一页" disabled={blocked || range.page === 1} onClick={() => onPageChange(range.page - 1)}><ChevronLeft size={15}/><span className="pagination-button-label">上一页</span></Button>
        <div className="pagination-numbers">{pageNumbers(range.page, range.pages).map((value, index) => value === 'gap' ? <span key={'gap' + index}>…</span> : <Button variant="secondary" type="button" key={value} aria-label={`第 ${value} 页`} aria-current={value === range.page ? 'page' : undefined} disabled={blocked} onClick={() => onPageChange(value)}>{value}</Button>)}</div>
        <PageJump key={range.page + ':' + range.pages} page={range.page} pages={range.pages} disabled={blocked} onChange={onPageChange}/>
        <Button variant="ghost" iconOnly type="button" aria-label="下一页" title="下一页" disabled={blocked || range.page === range.pages} onClick={() => onPageChange(range.page + 1)}><span className="pagination-button-label">下一页</span><ChevronRight size={15}/></Button>
      </div>}
    </nav>
  </footer>;
}
function PageJump({ page, pages, disabled, onChange }: { page: number; pages: number; disabled: boolean; onChange: (page: number) => void }) {
  const [value, setValue] = useState(String(page));
  const commit = () => {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1 && number <= pages) { if (number !== page) onChange(number); }
    else setValue(String(page));
  };
  return <form className="pagination-jump" onSubmit={event => { event.preventDefault(); commit(); }}><span>第</span><input type="number" inputMode="numeric" aria-label="跳转页码" min={1} max={pages} value={value} disabled={disabled} onChange={event => setValue(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Escape') setValue(String(page)); }}/><span>/ {pages} 页</span></form>;
}
