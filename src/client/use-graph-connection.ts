import {useEffect,useRef,useState,type RefObject} from 'react';
import type {Point} from './path-layout';
export type ConnectionSide='left'|'right'|'top'|'bottom';
type Issue={message:string;nodeIds?:string[]};
type Gesture={reconnectEnd?:'source'|'target';source:string;side:ConnectionSide;point:Point;origin:Point;pointerId:number|null;moved:boolean;target?:string;issue?:Issue|null};
type Options={container:RefObject<HTMLDivElement|null>;enabled:boolean;validate:(source:string,target:string,reconnectEnd?:'source'|'target')=>Issue|null;
  connect:(source:string,target:string,side:ConnectionSide,reconnectEnd?:'source'|'target')=>void;invalid:(issue:Issue)=>void;dropEmpty?:(source:string,point:Point)=>void};
/** The whole card is a destination. A gesture has one completion path, independent of route handles. */
export function useGraphConnection(options:Options){
  const latest=useRef(options);latest.current=options;
  const current=useRef<Gesture|null>(null),[gesture,setGesture]=useState<Gesture|null>(null),suppressClick=useRef(false);
  const update=(value:Gesture|null)=>{current.current=value;setGesture(value);};
  const hit=(point:Point)=>{
    const root=latest.current.container.current,element=document.elementFromPoint(point.x,point.y);
    if(!root||!element||!root.contains(element)||element.closest('.graph-overlay,.graph-view-controls,.dependency-layout-notice'))return {inside:false};
    const node=element.closest<HTMLElement>('.react-flow__node:not(.graph-node-hidden)');
    return {inside:!!element.closest('.react-flow')&&!element.closest('.react-flow__edge'),id:node?.dataset.id};
  };
  const resolve=(value:Gesture,point:Point):Gesture=>{
    const target=hit(point).id;
    return {...value,point,target,issue:target===value.target?value.issue:target?latest.current.validate(value.reconnectEnd==='source'?target:value.source,value.reconnectEnd==='source'?value.source:target,value.reconnectEnd):null};
  };
  const cancel=()=>update(null);
  const choose=(target:string)=>{
    const value=current.current;if(!value)return false;update(null);
    const issue=latest.current.validate(value.reconnectEnd==='source'?target:value.source,value.reconnectEnd==='source'?value.source:target,value.reconnectEnd);if(issue)latest.current.invalid(issue);else latest.current.connect(value.reconnectEnd==='source'?target:value.source,value.reconnectEnd==='source'?value.source:target,value.side,value.reconnectEnd);
    return true;
  };
  const finish=(point:Point,allowEmpty:boolean)=>{
    const value=current.current;if(!value)return;const target=hit(point);
    if(!target.inside){update(null);return;}
    if(target.id)choose(target.id);
    else {update(null);if(allowEmpty&&!value.reconnectEnd)latest.current.dropEmpty?.(value.source,point);}
  };
  const begin=(source:string,side:ConnectionSide,point:Point,pointerId:number|null,reconnectEnd?:'source'|'target')=>{
    if(!latest.current.enabled)return;
    update({source,side,point,origin:point,pointerId,moved:false,reconnectEnd});
    latest.current.container.current?.focus({preventScroll:true});
  };
  // Native listeners keep the gesture alive outside the canvas without capturing the drop target.
  const handlers=useRef({resolve,finish,cancel});handlers.current={resolve,finish,cancel};
  useEffect(()=>{
    const move=(event:PointerEvent)=>{const value=current.current;if(!value)return;
      if(value.pointerId!==null&&value.pointerId!==event.pointerId)return;
      const point={x:event.clientX,y:event.clientY};const next=handlers.current.resolve(value,point);
      update({...next,moved:value.moved||Math.hypot(point.x-value.origin.x,point.y-value.origin.y)>5});
    };
    const up=(event:PointerEvent)=>{const value=current.current;if(!value||value.pointerId!==event.pointerId)return;
      if(value.moved){suppressClick.current=true;handlers.current.finish({x:event.clientX,y:event.clientY},true);setTimeout(()=>{suppressClick.current=false;},0);}
      else update({...value,pointerId:null});
    };
    const cancelEvent=()=>handlers.current.cancel();
    document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancelEvent);window.addEventListener('blur',cancelEvent);
    return()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancelEvent);window.removeEventListener('blur',cancelEvent);};
  },[]);
  useEffect(()=>{if(!options.enabled)handlers.current.cancel();},[options.enabled]);
  return {gesture,current,cancel,begin,choose,
    pointerDown(event:React.PointerEvent<HTMLDivElement>){
      const element=event.target as HTMLElement;
      if(element.closest('.graph-overlay,.graph-view-controls,.dependency-layout-notice')){cancel();return;}
      if(current.current?.pointerId===null){event.preventDefault();event.stopPropagation();suppressClick.current=true;finish({x:event.clientX,y:event.clientY},false);setTimeout(()=>{suppressClick.current=false;},0);return;}
      const handle=element.closest<HTMLElement>('.business-handle'),node=handle?.closest<HTMLElement>('.react-flow__node');
      if(handle&&node?.dataset.id&&event.button===0){event.preventDefault();event.stopPropagation();begin(node.dataset.id,handle.dataset.side as ConnectionSide,{x:event.clientX,y:event.clientY},event.pointerId);}
    },
    click(event:React.MouseEvent<HTMLDivElement>){
      if(suppressClick.current){event.preventDefault();event.stopPropagation();return;}
      if(event.detail!==0){if((event.target as HTMLElement).closest('.business-handle')){event.preventDefault();event.stopPropagation();}return;}
      const element=event.target as HTMLElement,handle=element.closest<HTMLElement>('.business-handle'),node=element.closest<HTMLElement>('.react-flow__node');
      if(!node?.dataset.id)return;
      if(current.current){event.preventDefault();event.stopPropagation();const box=element.getBoundingClientRect();finish({x:box.x+box.width/2,y:box.y+box.height/2},false);}
      else if(handle){event.preventDefault();event.stopPropagation();const box=handle.getBoundingClientRect();begin(node.dataset.id,handle.dataset.side as ConnectionSide,{x:box.x+box.width/2,y:box.y+box.height/2},null);}
    }};
}
