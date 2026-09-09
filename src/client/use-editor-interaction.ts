import {useEffect,useRef,useSyncExternalStore} from 'react';
import {EditorInteraction,type EditorSelection} from './editor-interaction';

export function useEditorInteraction(node:string,onChange:(selection:EditorSelection)=>void,edge?:string){
  const ref=useRef<EditorInteraction|null>(null);if(!ref.current){ref.current=new EditorInteraction();if(node)ref.current.nodes([node],node);else if(edge)ref.current.select({kind:'edge',id:edge});}
  const interaction=ref.current,selection=useSyncExternalStore(interaction.subscribe,interaction.snapshot);
  const latest=useRef(onChange);latest.current=onChange;
  const external=useRef(JSON.stringify([node,edge]));
  useEffect(()=>interaction.subscribe(()=>latest.current(interaction.selection)),[interaction]);
  useEffect(()=>{const key=JSON.stringify([node,edge]);if(external.current===key)return;external.current=key;const selected=interaction.selection.kind==='nodes'?interaction.selection.primary:'';
    if(node){if(node!==selected)interaction.nodes([node],node);}else if(edge){interaction.select({kind:'edge',id:edge});}else if(interaction.selection.kind==='nodes'||edge!==undefined&&interaction.selection.kind!=='none')interaction.select({kind:'none'});
  },[node,edge,interaction]);
  return {interaction,selection,selected:selection.kind==='nodes'?selection.primary:'',edgeId:selection.kind==='edge'?selection.id:'',
    select:(id:string)=>interaction.nodes(id?[id]:[],id,true),setEdgeId:(id:string)=>{if(id)interaction.select({kind:'edge',id});else if(interaction.selection.kind==='edge')interaction.select({kind:'none'});}};
}
