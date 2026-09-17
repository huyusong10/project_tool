
import type { ReactNode } from 'react';
import type { EditorAdapter } from "../../editor-adapter";
import type { EditorInteraction } from "../../editor-interaction";
import type { GraphCard, GraphLink } from "../../path-projection";
import type { Point } from "../../path-layout";

export type GraphConnectionIssue = { message: string; nodeIds?: string[]; edgeIds?: string[]; kind?: 'duplicate'|'cycle'; attempt?:{source:string;target:string} };

export type DependencyGraphProps = {
  selectedPhaseId?:string;
  focusRegionId?:string;regions?:import('../../phase-layout').PhaseRegion[];onSelectPhase?:(featureId:string,phaseId:string)=>void;constrainPosition?:(id:string,p:Point)=>Point;
  commands:EditorAdapter;interaction:EditorInteraction;originPositions?:Record<string,Point>;onOrigin?:(positions:Record<string,Point>)=>void;
  cards: GraphCard[]; links: GraphLink[]; viewKey: string; historyIndex?:number;
  children?: ReactNode; visibleIds?:string[]; emphasizedIds?:string[]; contextIds?:string[]; onExitFocus?:()=>void; editing?: boolean;
  validateConnection?: (source: string, target: string) => GraphConnectionIssue | null;
  onInvalid?: (issue: GraphConnectionIssue) => void; onInspectIssue?:(issue:GraphConnectionIssue)=>void; onClearIssue?:()=>void; invalidEdges?:string[]; onDismissOverlays?:()=>boolean; onDropEmpty?: (source: string,position:Point) => void;
  highlighted?: string[]; invalidNodes?: string[]; locate?: { id: string; sequence: number };
  reconnect?:{id:string;source:string;target:string}; validateReconnect?:(source:string,target:string)=>GraphConnectionIssue|null;
  focusId?:string;
  onOpenNode?:(card:GraphCard)=>void;
  onLayoutReady?:(positions:Record<string,Point>,regions?:import('../../phase-layout').PhaseRegion[])=>void;positions?:Record<string,Point>;
  placing?:string;onSearch?:()=>void;onRevealField?:(key:string)=>void;
};
