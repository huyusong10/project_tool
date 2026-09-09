import {routeFixedGraph,type PositionedNode} from './fixed-routing';
import type {LayoutEdge} from './path-layout';
self.onmessage=(event:MessageEvent<{id:number;nodes:PositionedNode[];edges:LayoutEdge[]}>)=>{const {id,nodes,edges}=event.data;try{self.postMessage({id,layout:routeFixedGraph(nodes,edges)});}catch(error){self.postMessage({id,error:(error as Error).message});}};
