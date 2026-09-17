import { validPageReturn } from './page-return';
import { sessionAccessKey } from './session-identity';
import { useAppNavigate, useAppSearchParams } from './use-app-navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, type SetURLSearchParams } from 'react-router-dom';
import { useProjects, useSession } from './app-context';
import { migrateFeatureSearch } from './feature-storage-migration';
import { restorePageSearch } from './page-foundation';
import { useResolvedPage } from './page-context';

const prefix = 'pm-page-view:';

function read(key: string) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
function write(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* Personal view storage must not prevent navigation. */ }
}

export function usePageKey(personal: boolean) {
  const { session } = useSession();
  const { selectedProjectId } = useProjects();
  const { pathname } = useLocation();
  return `${prefix}${session.accountId || session.username}:${personal ? 'personal' : selectedProjectId}:${pathname}`;
}

/** URL is the active view; a remembered view only supplies the initial entry without a query. */
export function usePageSearchParams(allowedKeys: readonly string[], personal = false) {
  const key = usePageKey(personal);
  const location = useLocation();
  const [initial] = useState(() => restorePageSearch(migrateFeatureSearch(location.search), migrateFeatureSearch(read(key))));
  const initialLocationKey = useRef(location.key);
  const [urlParams, setParams] = useAppSearchParams();
  const imported = useRef(false);
  // URL 替换完成前继续使用记忆值，避免多个列表挂载时的重绘清空筛选。
  const params = location.key === initialLocationKey.current ? initial : urlParams;
  const set: SetURLSearchParams = useCallback((next, options) => {
    setParams(next, { replace: true, state: location.state, ...options });
  }, [setParams, location.state]);
  useEffect(() => {
    if (imported.current) return;
    imported.current = true;
    if (initial.toString() !== new URLSearchParams(location.search).toString()) set(initial);
  }, [initial, location.search, set]);
  const serialized = params.toString();
  const allowed = allowedKeys.join(',');
  useEffect(() => {
    const value = new URLSearchParams(serialized), saved = new URLSearchParams(migrateFeatureSearch(read(key)));
    // 同页多个列表各自保存拥有的参数，不覆盖其他列表或页面筛选。
    for (const name of allowed.split(',')) {
      saved.delete(name);
      if (value.has(name)) saved.set(name, value.get(name)!);
    }
    write(key, saved.toString());
  }, [key, serialized, allowed]);
  return [params, set] as const;
}

/** Restore after list data is ready. Filtering does not replay the initial scroll position. */
export function usePageScrollPosition(ready: boolean, personal = false) {
  const key = usePageKey(personal) + ':scroll';
  const [initial] = useState(() => Math.max(0, Number(read(key)) || 0));
  const restored = useRef(false);
  const position = useRef(initial);
  useLayoutEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    window.scrollTo({ top: initial, behavior: 'instant' });
    position.current = window.scrollY;
  }, [ready, initial]);
  useEffect(() => {
    const remember = () => {
      if (!restored.current) return;
      position.current = window.scrollY;
      write(key, String(position.current));
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.removeEventListener('scroll', remember);
      if (restored.current) write(key, String(position.current));
    };
  }, [key]);
}

export function clearPageViews() {
  try { for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}

export function usePageBack(fallback: string) {
  const navigate = useAppNavigate();
  const {back} = useResolvedPage(),{session}=useSession(),{projects}=useProjects();
  return (target?:string) => {
    const source=window.history.state?.usr?.pageReturn,index=window.history.state?.idx||0;
    if(back?.kind!=='templates'&&validPageReturn(source,sessionAccessKey(session),index,projects.map(p=>p.id)))navigate(source.index-index);
    else navigate(target||back?.fallback||fallback,{replace:true});
  };
}

export function hasPageHistory() {
  return window.history.state?.idx > 0;
}
