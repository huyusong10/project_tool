import { useEffect, useState } from 'react';

export function useSidebarPreference() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('project-manage:sidebar-collapsed') === 'true'; } catch { return false; }
  });
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 620px)').matches);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try { localStorage.setItem('project-manage:sidebar-collapsed', String(collapsed)); } catch { /* In-memory preference remains usable. */ }
  }, [collapsed]);
  useEffect(() => {
    const media = matchMedia('(max-width: 620px)');
    const change = () => { setNarrow(media.matches); setExpanded(false); };
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  return { collapsed: narrow ? !expanded : collapsed,
    toggle: () => narrow ? setExpanded(value => !value) : setCollapsed(value => !value),
    navigated: () => setExpanded(false) };
}
