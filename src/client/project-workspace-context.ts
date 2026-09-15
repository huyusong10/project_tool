import {createContext,useContext,type ReactNode} from 'react';
import type {PathAnalysis} from '../shared/paths';
import type {PageChrome} from './page-chrome';
import type {WorkspaceLocation,WorkspaceScope,WorkspaceView} from './workspace-location';
export type ProjectWorkspaceContextValue={
  draftControls?:ReactNode;
  location:WorkspaceLocation;data:PathAnalysis;
  enter:(scope:WorkspaceScope)=>void;inspect:(id?:string)=>void;
  switchView:(view:WorkspaceView,locateId?:string)=>void;
  navigation:Pick<PageChrome,'breadcrumbs'|'navigationLabel'|'onBack'|'backLabel'|'views'>;
};
export const ProjectWorkspaceContext=createContext<ProjectWorkspaceContextValue|null>(null);
export const useProjectWorkspace=()=>useContext(ProjectWorkspaceContext);
