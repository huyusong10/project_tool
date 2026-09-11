export const pageSizeOptions = [10, 20, 50];
export function paginationKeys(id = 'main') {
  return id === 'main' ? ['page', 'pageSize'] as const : [`${id}.page`, `${id}.pageSize`] as const;
}
export function readPagination(params: URLSearchParams, defaultPageSize = 20, id = 'main', options = pageSizeOptions) {
  const [pageKey, sizeKey] = paginationKeys(id);
  const number = Number(params.get(pageKey)), size = Number(params.get(sizeKey));
  return { page: Number.isSafeInteger(number) && number > 0 ? number : 1, pageSize: options.includes(size) ? size : defaultPageSize };
}
export function pageRange(total: number, page: number, pageSize: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize)), safePage = Math.min(pages, Math.max(1, page));
  return { page: safePage, pages, start: total ? (safePage - 1) * pageSize : 0, end: Math.min(total, safePage * pageSize) };
}
export function pageNumbers(page: number, pages: number): Array<number | 'gap'> {
  const values = [...new Set([1, page - 1, page, page + 1, pages])].filter(value => value >= 1 && value <= pages).sort((a, b) => a - b);
  return values.flatMap((value, index) => index && value - values[index - 1] > 1 ? ['gap', value] : [value]) as Array<number | 'gap'>;
}
