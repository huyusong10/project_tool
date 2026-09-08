import {useEffect,useRef,useSyncExternalStore} from 'react';
import {EditorInteraction,type EditorSelection} from './editor-interaction';

export function useEditorInteraction(node:string,onChange:(selection:EditorSelection)=>void){
  const ref=useRef<EditorInteraction|null>(null);if(!ref.current){ref.current=new EditorInteraction();if(node)ref.current.nodes([node],node);}
  const interaction=ref.current,selection=useSyncExternalStore(interaction.subscribe,interaction.snapshot);
  const latest=useRef(onChange);latest.current=onChange;
  const external=useRef(node);
  useEffect(()=>interaction.subscribe(()=>latest.current(interaction.selection)),[interaction]);
  useEffect(()=>{if(external.current===node)return;external.current=node;const selected=interaction.selection.kind==='nodes'?interaction.selection.primary:'';if(node!==selected)interaction.nodes(node?[node]:[],node);},[node,interaction]);
  return {interaction,selection,selected:selection.kind==='nodes'?selection.primary:'',edgeId:selection.kind==='edge'?selection.id:'',
    select:(id:string)=>interaction.nodes(id?[id]:[],id,true),setEdgeId:(id:string)=>{if(id)interaction.select({kind:'edge',id});else if(interaction.selection.kind==='edge')interaction.select({kind:'none'});}};
}
