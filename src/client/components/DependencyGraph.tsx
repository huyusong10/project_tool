import { ReactFlowProvider } from '@xyflow/react';

import { GraphScene } from './GraphScene';

import { type DependencyGraphProps } from '../features/graph/model';

export function DependencyGraph(props:DependencyGraphProps){
  return <ReactFlowProvider key={props.viewKey}><GraphScene {...props}/></ReactFlowProvider>;
}

export type { GraphConnectionIssue } from '../features/graph/model';
export type { DependencyGraphProps } from '../features/graph/model';
