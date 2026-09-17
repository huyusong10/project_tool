import {useProjects,useSession} from '../app-context';
import {isGuestWorkspace} from '../permissions';
import {useProjectWorkspace} from '../project-workspace-context';
import {useContext, useLayoutEffect, useRef} from 'react';
import {usePageChromeStore, type PageChrome} from '../page-chrome';
import {WorkspaceRuntimeContext} from '../workspace-runtime';

/** 页面只发布一份声明；应用外壳统一绘制标题和工具栏。 */
export function PageHeader(props: Omit<PageChrome, 'runtime'>) {
  const store = usePageChromeStore(),workspace=useProjectWorkspace();
  const {session}=useSession(),{projects,selectedProjectId}=useProjects(),guest=isGuestWorkspace(session,projects.find(p=>p.id===selectedProjectId));
  const runtime = useContext(WorkspaceRuntimeContext);
  const owner = useRef(Symbol('page-chrome'));
  useLayoutEffect(() => { store.publish(store.navigationKey, owner.current, {...props,...workspace?.navigation, actions:workspace?<>{props.actions}{workspace.actions&&<div className="workspace-create-action">{workspace.actions}</div>}</>:props.actions,moreActions:workspace?<>{workspace.moreActions}{props.moreActions}{workspace.draftControls}</>:props.moreActions,runtime,...(guest&&workspace?{status:<span className="text-muted">游客浏览</span>,actions:<></>,secondaryActions:workspace.location.view==='graph'?props.secondaryActions:undefined,moreActions:workspace.location.view==='graph'?props.moreActions:undefined,context:undefined}:{})}); });
  useLayoutEffect(() => { const token = owner.current; return () => store.release(store.navigationKey, token); }, [store]);
  return null;
}
