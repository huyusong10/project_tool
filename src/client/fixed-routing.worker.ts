import {routeFixedGraph,type PositionedNode} from './fixed-routing';
import type {LayoutEdge} from './path-layout';
self.onmessage=(event:MessageEvent<{id:number;nodes:PositionedNode[];edges:LayoutEdge[];obstacles?:Array<{left:number;right:number;top:number;bottom:number}>}>)=>{const {id,nodes,edges,obstacles}=event.data;try{self.postMessage({id,layout:routeFixedGraph(nodes,edges,obstacles)});}catch(error){self.postMessage({id,error:(error as Error).message});}};
