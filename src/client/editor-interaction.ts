import type {Point} from './path-layout';
export type EditorSelection={kind:'none'}|{kind:'nodes';ids:string[];primary:string}|{kind:'edge';id:string};
export type GestureKind='move'|'connect'|'reconnect'|'place'|'field';
export type Operation={id:number;kind:GestureKind;cancel:()=>void};
export type SceneVersion={structure:string;coordinates:string;sequence:number};
export class SceneRequests{
  private latest:SceneVersion={structure:'',coordinates:'',sequence:0};
  request(structure:string,coordinates:string){this.latest={structure,coordinates,sequence:this.latest.sequence+1};return {...this.latest};}
  invalidate(){this.latest={...this.latest,sequence:this.latest.sequence+1};}
  accepts(version:SceneVersion){return version.sequence===this.latest.sequence&&version.structure===this.latest.structure&&version.coordinates===this.latest.coordinates;}
}
/** A finished/cancelled ticket cannot commit again, even after another gesture starts. */
export class EditorInteraction{
  selection:EditorSelection={kind:'none'};operation:Operation|null=null;
  private sequence=0;private listeners=new Set<()=>void>();
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  snapshot=()=>this.selection;
  select(selection:EditorSelection,activate=false){const same=JSON.stringify(selection)===JSON.stringify(this.selection);if(same&&!activate)return;if(!same)this.selection=selection;for(const fn of this.listeners)fn();}
  nodes(ids:string[],primary=ids.at(-1)||'',activate=false){const unique=[...new Set(ids)];this.select(unique.length?{kind:'nodes',ids:unique,primary:unique.includes(primary)?primary:unique.at(-1)!}:{kind:'none'},activate);}
  begin(kind:GestureKind,cancel:()=>void){this.cancel();const id=++this.sequence;this.operation={id,kind,cancel};return id;}
  isCurrent(id:number){return this.operation?.id===id;}
  complete(id:number,commit:()=>void){if(!this.isCurrent(id))return false;this.operation=null;commit();return true;}
  cancel(){const operation=this.operation;if(!operation)return false;this.operation=null;operation.cancel();return true;}
}
export type EditorCommand=
 |{type:'move';positions:Record<string,Point>}
 |{type:'rename';id:string;title:string}
 |{type:'properties';id:string;fields:Record<string,unknown>}
 |{type:'create';kind:string;position:Point}
 |{type:'duplicate';ids:string[];positions:Record<string,Point>;snapshot?:unknown}
 |{type:'delete';ids:string[];edgeId?:string}
 |{type:'connect'|'reconnect';source:string;target:string}
 |{type:'undo'|'redo'|'save'};
