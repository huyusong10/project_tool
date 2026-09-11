import {useContext, useLayoutEffect, useRef} from 'react';
import {usePageChromeStore, type PageChrome} from '../page-chrome';
import {WorkspaceRuntimeContext} from '../workspace-runtime';

/** 页面一次发布声明；顶栏拥有全部显示结构。 */
export function PageHeader(props: Omit<PageChrome, 'runtime'>) {
  const store = usePageChromeStore();
  const runtime = useContext(WorkspaceRuntimeContext);
  const owner = useRef(Symbol('page-chrome'));
  useLayoutEffect(() => { store.publish(store.navigationKey, owner.current, {...props, runtime}); });
  useLayoutEffect(() => { const token = owner.current; return () => store.release(store.navigationKey, token); }, [store]);
  return null;
}
