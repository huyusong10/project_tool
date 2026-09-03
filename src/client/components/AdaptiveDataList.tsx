import type { CSSProperties, ReactNode } from 'react';

type AdaptiveStyle = CSSProperties & { '--adaptive-columns'?: string };

export function AdaptiveDataList({ label, columns, headers, className = '', children }: {
  label: string;
  columns: string;
  headers: string[];
  className?: string;
  children: ReactNode;
}) {
  return <section
    className={`adaptive-data-list ${className}`.trim()}
    style={{ '--adaptive-columns': columns } as AdaptiveStyle}
    role="table"
    aria-label={label}
  >
    <div className="adaptive-data-list-header" role="row">
      {headers.map((header) => <span key={header} role="columnheader">{header}</span>)}
    </div>
    <div className="adaptive-data-list-body" role="rowgroup">{children}</div>
  </section>;
}

export function AdaptiveDataRow({ className = '', children }: { className?: string; children: ReactNode }) {
  return <article className={`adaptive-data-row ${className}`.trim()} role="row">{children}</article>;
}

export function AdaptiveDataCell({ label, className = '', children }: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`adaptive-data-cell ${className}`.trim()} role="cell" data-label={label}>{children}</div>;
}
