import { useCallback, useContext } from 'react';
import { useNavigate, useLocation, useSearchParams, createSearchParams, type NavigateFunction, type SetURLSearchParams } from 'react-router-dom';
import { PageChromeContext } from './page-chrome';
import { pageIdentity } from './page-foundation';

/** 顶栏、页面按钮及返回共用编辑收尾；视图参数变化继续原位更新。 */
export function useAppNavigate(): NavigateFunction {
  const navigate = useNavigate(), location = useLocation(), chrome = useContext(PageChromeContext);
  return useCallback(((to, options) => {
    if (typeof to === 'number') { chrome?.prepareNavigation(); return navigate(to); }
    const target = typeof to === 'string' ? new URL(to, window.location.href) : {
      pathname: to.pathname || location.pathname, search: to.search ?? location.search,
    };
    if (pageIdentity(target.pathname, new URLSearchParams(target.search)) !== pageIdentity(location.pathname, new URLSearchParams(location.search))) chrome?.prepareNavigation();
    return navigate(to, options);
  }) as NavigateFunction, [navigate, location.pathname, location.search, chrome]);
}

/** URL 中的编辑模式变化也经过相同收尾；筛选和视口更新不会结束手势。 */
export function useAppSearchParams() {
  const [params, setParams] = useSearchParams();
  const location = useLocation(), chrome = useContext(PageChromeContext);
  const set: SetURLSearchParams = useCallback((next, options) => {
    const value = createSearchParams(typeof next === 'function' ? next(params) : next);
    if (pageIdentity(location.pathname, value) !== pageIdentity(location.pathname, params)) chrome?.prepareNavigation();
    setParams(value, options);
  }, [params, setParams, location.pathname, chrome]);
  return [params, set] as const;
}
