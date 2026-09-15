import { createContext, useContext, type CSSProperties, type ReactNode, type Ref } from 'react';

export type AdaptiveDataColumn = {
  key: string;
  label: string;
  track: string;
  importance?: 'primary' | 'essential' | 'secondary';
  compact?: 'primary' | 'detail' | 'full' | 'actions' | 'hidden';
  align?: 'start' | 'center' | 'end';
};

type AdaptiveStyle = CSSProperties & {
  '--adaptive-columns'?: string;
  '--adaptive-medium-columns'?: string;
};

const AdaptiveColumnsContext = createContext<Record<string, AdaptiveDataColumn>>({});

export function AdaptiveDataList({ label, columns, className = '', empty, footer, children, bodyRef, layout = 'adaptive' }: {
  label: string;
  columns: AdaptiveDataColumn[];
  className?: string;
  empty?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  bodyRef?: Ref<HTMLDivElement>;
  layout?: 'adaptive' | 'scroll';
}) {
  const columnMap = Object.fromEntries(columns.map((column) => [column.key, column]));
  const style = {
    '--adaptive-columns': columns.map((column) => column.track).join(' '),
    '--adaptive-medium-columns': columns.filter((column) => column.importance !== 'secondary').map((column) => column.track).join(' '),
  } as AdaptiveStyle;
  const content = <>
      <div className="adaptive-data-list-header" role="row">
        {columns.map((column) => <span
          key={column.key}
          role="columnheader"
          data-column={column.key}
          data-importance={column.importance || 'essential'}
          data-align={column.align || 'start'}
        >{column.label}</span>)}
      </div>
      <div className={`adaptive-data-list-body${bodyRef && layout === 'adaptive' ? ' paged-body' : ''}`} ref={layout === 'adaptive' ? bodyRef : undefined} role="rowgroup">{children}</div>
  </>;
  return <AdaptiveColumnsContext.Provider value={columnMap}>
    <section className={`adaptive-data-list ${layout === 'scroll' ? 'is-scroll-table' : ''} ${className}`.trim()} style={style} role="table" aria-label={label}>
      {layout === 'scroll' ? <div className="adaptive-table-scroll paged-body" ref={bodyRef} tabIndex={0} aria-label={label+'，可横向滚动'}>{content}</div> : content}
      {empty && <div className="adaptive-data-list-empty">{empty}</div>}
      {footer && <div className="adaptive-data-list-footer">{footer}</div>}
    </section>
  </AdaptiveColumnsContext.Provider>;
}

export function AdaptiveDataRow({ className = '', children }: { className?: string; children: ReactNode }) {
  return <article className={`adaptive-data-row ${className}`.trim()} role="row">{children}</article>;
}

export function AdaptiveDataCell({ column, label, className = '', children }: {
  column?: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const columns = useContext(AdaptiveColumnsContext);
  const definition = column ? columns[column] : undefined;
  const resolvedLabel = label || definition?.label || column || '';
  return <div
    className={`adaptive-data-cell ${className}`.trim()}
    role="cell"
    data-column={column}
    data-label={resolvedLabel}
    data-importance={definition?.importance || 'essential'}
    data-compact={definition?.compact || 'detail'}
    data-align={definition?.align || 'start'}
  >{children}</div>;
}
