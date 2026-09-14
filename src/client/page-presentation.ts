export type ToolbarLayout = 'none' | 'single' | 'detail' | 'path' | 'editor' | 'analytics';

/** 文档占位和 React 页面使用相同的操作布局，不等待业务按钮加载。 */
export function toolbarForRoute(pathname: string, search = ''): ToolbarLayout {
  const params = new URLSearchParams(search);
  if (['/','/paths','/features'].includes(pathname)) return 'path';
  if (/^\/requirements\/[^/]+$/.test(pathname)) return params.get('view') === 'path' || params.has('draftProject') ? 'path' : 'detail';
  if (pathname === '/templates' && params.get('edit')) return 'editor';
  if (pathname === '/analytics') return 'analytics';
  return ['/features','/requirements','/issues','/templates','/projects','/resources','/project-settings'].includes(pathname) ? 'single' : 'none';
}
