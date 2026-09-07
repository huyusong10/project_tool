/** 统一分页条：替代 .table-pagination / .pagination 两套手写实现。 */
export function Pagination({
  page,
  pages,
  onChange,
  className = "table-pagination",
}: {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  className?: string;
}) {
  const safePage = page || 1;
  const safePages = pages || 1;
  return (
    <footer className={className}>
      <span>第 {safePage} / {safePages} 页</span>
      <div>
        <button className="ghost-button" disabled={safePage <= 1} onClick={() => onChange(safePage - 1)}>上一页</button>
        <button className="ghost-button" disabled={safePage >= safePages} onClick={() => onChange(safePage + 1)}>下一页</button>
      </div>
    </footer>
  );
}
