import type {EditorCommand} from './editor-interaction';
import type {Point} from './path-layout';
export type EditorHandlers={
  properties?:(id:string,fields:Record<string,unknown>)=>void;
  move?:(positions:Record<string,Point>)=>void;rename?:(id:string,title:string)=>void;create?:(kind:string,position:Point)=>void;
  duplicate?:(ids:string[],positions:Record<string,Point>,snapshot?:unknown)=>void;delete?:(ids:string[],edgeId?:string)=>void;
  connect?:(source:string,target:string)=>void;reconnect?:(source:string,target:string)=>void;
  undo?:()=>void;redo?:()=>void;save?:()=>void;copy?:(ids:string[])=>unknown;
};
export type EditorAdapter={dispatch:(command:EditorCommand)=>boolean;copy:(ids:string[])=>unknown;allows:(type:EditorCommand['type'])=>boolean;disabledReason:(type:EditorCommand['type'])=>string|undefined};
export function editorAdapter(handlers:EditorHandlers,editable:boolean):EditorAdapter{
  const allows=(type:EditorCommand['type'])=>!!handlers[type]&&(editable||type==='save');
  return {allows,disabledReason:type=>!handlers[type]?'此处不支持该操作':!editable&&type!=='save'?'当前画布不可编辑':undefined,copy:ids=>handlers.copy?.(ids),dispatch:command=>{
    if(!allows(command.type))return false;
    switch(command.type){
      case 'properties':handlers.properties?.(command.id,command.fields);break;
      case 'move':handlers.move?.(command.positions);break;
      case 'rename':handlers.rename?.(command.id,command.title);break;
      case 'create':handlers.create?.(command.kind,command.position);break;
      case 'duplicate':handlers.duplicate?.(command.ids,command.positions,command.snapshot);break;
      case 'delete':handlers.delete?.(command.ids,command.edgeId);break;
      case 'connect':handlers.connect?.(command.source,command.target);break;
      case 'reconnect':handlers.reconnect?.(command.source,command.target);break;
      default:handlers[command.type]?.();
    }
    return true;
  }};
}
