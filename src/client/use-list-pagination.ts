import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePageKey, usePageSearchParams } from './use-page-view';
import { pageRange, paginationKeys, readPagination, pageSizeOptions } from './pagination';

export function useListPagination<T>({ items = [], total = items.length, id = 'main', defaultPageSize = 20,
  filterKey = '', personal = false, ready = true, loading = false, disabled = false,
  serverPage, serverPageSize, failed = false, options = pageSizeOptions,
}: {
  items?: readonly T[]; total?: number; id?: string; defaultPageSize?: number; filterKey?: string;
  personal?: boolean; ready?: boolean; loading?: boolean; disabled?: boolean;
  serverPage?: number; serverPageSize?: number; failed?: boolean; options?: number[];
}) {
  const [pageKey, sizeKey] = paginationKeys(id);
  const [params, setParams] = usePageSearchParams([pageKey, sizeKey], personal);
  const scope = usePageKey(personal) + ':' + id;
  const [element, scrollRef] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const panel = element?.closest<HTMLElement>('.paged-panel');
    if (!panel) return;
    const resize = () => { panel.dataset.pageScroll = String(panel.clientWidth < 640); };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [element]);
  const requested = readPagination(params, defaultPageSize, id, options);
  const previousFilter = useRef({ scope, value: filterKey });
  const filterChanged = previousFilter.current.scope === scope && previousFilter.current.value !== filterKey;
  const range = pageRange(total, serverPage ?? (filterChanged ? 1 : requested.page), serverPageSize ?? requested.pageSize);
  const setPage = useCallback((page: number) => setParams(current => {
    const next = new URLSearchParams(current); next.set(pageKey, String(page)); return next;
  }), [pageKey, setParams]);
  useEffect(() => {
    if (filterChanged && requested.page !== 1) setPage(1);
    previousFilter.current = { scope, value: filterKey };
  }, [filterChanged, filterKey, scope, setPage, requested.page]);
  useEffect(() => {
    if (ready && !loading && !filterChanged && requested.page > range.pages) setPage(range.pages);
  }, [ready, loading, filterChanged, requested.page, range.pages, setPage]);
  useEffect(() => {
    if (!loading && failed && serverPage && serverPageSize && (requested.page !== serverPage || requested.pageSize !== serverPageSize)) {
      setParams(current => { const next = new URLSearchParams(current); next.set(pageKey, String(serverPage)); next.set(sizeKey, String(serverPageSize)); return next; });
    }
  }, [loading, failed, serverPage, serverPageSize, requested.page, requested.pageSize, pageKey, sizeKey, setParams]);
  const onPageChange = (page: number) => { if (!loading && !disabled) setPage(pageRange(total, page, requested.pageSize).page); };
  const onPageSizeChange = (size: number) => {
    if (loading || disabled || !options.includes(size)) return;
    setParams(current => { const next = new URLSearchParams(current); next.set(pageKey, '1'); next.set(sizeKey, String(size)); return next; });
  };
  const scrollKey = `${scope}:scroll:${filterKey}:${range.page}:${serverPageSize ?? requested.pageSize}`;
  const previousScroll = useRef<{ scope: string; key: string; element: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    if (!element || !ready || loading) return;
    const first = previousScroll.current?.scope !== scope || previousScroll.current.element !== element;
    if (!first && previousScroll.current?.key === scrollKey) return;
    let top = 0;
    if (first) { try { top = Number(sessionStorage.getItem(scrollKey)) || 0; } catch { /* 可无存储使用。 */ } }
    element.scrollTop = top;
    if (!first && element.closest('.paged-panel') && (element.closest<HTMLElement>('.paged-panel')!.clientWidth < 640 || window.innerHeight < 640)) {
      const panel = element.closest('.paged-panel') || element;
      window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - 76, behavior: 'instant' });
    }
    previousScroll.current = { scope, key: scrollKey, element };
  }, [element, ready, loading, scope, scrollKey]);
  useEffect(() => {
    if (!element || !ready || loading) return;
    const remember = () => { try { sessionStorage.setItem(scrollKey, String(element.scrollTop)); } catch { /* 可无存储使用。 */ } };
    element.addEventListener('scroll', remember, { passive: true });
    return () => element.removeEventListener('scroll', remember);
  }, [element, ready, loading, scrollKey]);
  return { ...requested, items: items.slice(range.start, range.end), scrollRef,
    props: { page: range.page, pageSize: serverPageSize ?? requested.pageSize, total, onPageChange, onPageSizeChange, loading, disabled, pageSizeOptions: options } };
}
