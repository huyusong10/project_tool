import {useContext, useLayoutEffect, useRef} from 'react';
import {usePageChromeStore, type PageChrome} from '../page-chrome';
import {WorkspaceRuntimeContext} from '../workspace-runtime';

/** 页面只发布一份声明；应用外壳统一绘制标题和工具栏。 */
export function PageHeader(props: Omit<PageChrome, 'runtime'>) {
  const store = usePageChromeStore();
  const runtime = useContext(WorkspaceRuntimeContext);
  const owner = useRef(Symbol('page-chrome'));
  useLayoutEffect(() => { store.publish(store.navigationKey, owner.current, {...props, runtime}); });
  useLayoutEffect(() => { const token = owner.current; return () => store.release(store.navigationKey, token); }, [store]);
  return null;
}
