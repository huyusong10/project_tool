import { createContext, useContext } from 'react';
import type { Issue, Project, Requirement, WorkItemTemplate } from './types';
import type { PageScope } from './page-foundation';
import type { useResourceQuery } from './use-resource-query';
import type {ToolbarLayout} from './page-presentation';

export type ResourceQuery<T> = ReturnType<typeof useResourceQuery<T>>;
export type ResolvedPageContext = {
  navigationKey: string;
  phase: 'loading' | 'ready' | 'error';
  scope: PageScope;
  project?: Project;
  title: string;
  actionRow: boolean;
  toolbar: ToolbarLayout;
  object?: {kind: 'requirement' | 'issue' | 'template' | 'draft'; id: string};
  back?: {label: string; fallback: string; kind: 'history' | 'path' | 'templates'};
  error?: Error;
  errorTitle?: string;
  retry: () => unknown;
};
export type PageResources = {
  requirement: ResourceQuery<Requirement>;
  issue: ResourceQuery<Issue>;
  templates: ResourceQuery<WorkItemTemplate[]>;
};
export const ResolvedPageContext = createContext<ResolvedPageContext | null>(null);
export const PageResourcesContext = createContext<PageResources | null>(null);
export function useResolvedPage() {
  const page = useContext(ResolvedPageContext);
  if (!page) throw new Error('页面上下文未初始化');
  return page;
}
export function usePageResources() {
  const value = useContext(PageResourcesContext);
  if (!value) throw new Error('页面资料未初始化');
  return value;
}

export {rememberedProject, rememberProject, pageIdentity, chooseProject} from './page-foundation';
