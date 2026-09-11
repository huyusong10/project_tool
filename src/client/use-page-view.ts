import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams, type SetURLSearchParams } from 'react-router-dom';
import { useProjects, useSession } from './app-context';

const prefix = 'pm-page-view:';

function read(key: string) {
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}
function write(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* Personal view storage must not prevent navigation. */ }
}

function usePageKey(personal: boolean) {
  const { session } = useSession();
  const { selectedProjectId } = useProjects();
  const { pathname } = useLocation();
  return `${prefix}${session.accountId || session.username}:${personal ? 'personal' : selectedProjectId}:${pathname}`;
}

/** URL is the active view; a remembered view only supplies the initial entry without a query. */
export function usePageSearchParams(allowedKeys: readonly string[], personal = false) {
  const key = usePageKey(personal);
  const location = useLocation();
  const [initial] = useState(() => new URLSearchParams(location.search || read(key)));
  const [urlParams, setParams] = useSearchParams();
  const imported = useRef(false);
  const params = !imported.current && !location.search ? initial : urlParams;
  const set: SetURLSearchParams = useCallback((next, options) => {
    setParams(next, { replace: true, state: location.state, ...options });
  }, [setParams, location.state]);
  useEffect(() => {
    if (imported.current) return;
    imported.current = true;
    if (!location.search && initial.size) set(initial);
  }, [initial, location.search, set]);
  const serialized = params.toString();
  const allowed = allowedKeys.join(',');
  useEffect(() => {
    const value = new URLSearchParams(serialized), saved = new URLSearchParams();
    for (const name of allowed.split(',')) if (value.has(name)) saved.set(name, value.get(name)!);
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
  const navigate = useNavigate();
  return () => {
    if (hasPageHistory()) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

export function hasPageHistory() {
  return window.history.state?.idx > 0;
}
