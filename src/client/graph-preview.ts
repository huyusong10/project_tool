import {roundedRoutePath,type Point,type RoutedLayout} from './path-layout';
export type PreviewSide='left'|'right'|'top'|'bottom';
export type PreviewBox=Point&{width:number;height:number};
const normal:Record<PreviewSide,Point>={left:{x:-1,y:0},right:{x:1,y:0},top:{x:0,y:-1},bottom:{x:0,y:1}};
export function facingSide(box:PreviewBox,towards:Point):PreviewSide{
  const dx=towards.x-box.x-box.width/2,dy=towards.y-box.y-box.height/2;
  return Math.abs(dx)/box.width>=Math.abs(dy)/box.height?dx<0?'left':'right':dy<0?'top':'bottom';
}
export function previewPort(box:PreviewBox,side:PreviewSide):Point{
  return {x:box.x+(side==='left'?0:side==='right'?box.width:box.width/2),y:box.y+(side==='top'?0:side==='bottom'?box.height:box.height/2)};
}
/** Lightweight live feedback in screen units. Final obstacle routing remains in the Worker. */
export function previewCurve(source:PreviewBox,target:PreviewBox|Point,sourceSide?:PreviewSide,reverse=false,landingSide?:PreviewSide){
  const isBox='width' in target,center=isBox?{x:target.x+target.width/2,y:target.y+target.height/2}:target;
  const side=sourceSide||facingSide(source,center),out=normal[side],port=previewPort(source,side);
  const start=reverse?{x:port.x+out.x*6,y:port.y+out.y*6}:port;
  const targetSide=isBox?landingSide||facingSide(target,start):null,inward=targetSide?normal[targetSide]:null;
  const border=isBox?previewPort(target,targetSide!):target;
  const end=inward?{x:border.x+inward.x*6,y:border.y+inward.y*6}:border;
  const distance=Math.hypot(end.x-start.x,end.y-start.y);
  if(distance<4)return {start,end,d:'',points:[]};
  const reach=Math.max(2,Math.min(24,distance/3));
  const lead={x:start.x+out.x*reach,y:start.y+out.y*reach},tail=inward?{x:end.x+inward.x*reach,y:end.y+inward.y*reach}:end;
  const boxes=isBox?[source,target]:[source],left=Math.min(...boxes.map(b=>b.x),end.x)-24,right=Math.max(...boxes.map(b=>b.x+b.width),end.x)+24;
  const top=Math.min(...boxes.map(b=>b.y),end.y)-24,bottom=Math.max(...boxes.map(b=>b.y+b.height),end.y)+24;
  const candidates=[[start,lead,{x:tail.x,y:lead.y},tail,end],[start,lead,{x:lead.x,y:tail.y},tail,end],
    ...[top,bottom].map(y=>[start,lead,{x:lead.x,y},{x:tail.x,y},tail,end]),
    ...[left,right].map(x=>[start,lead,{x,y:lead.y},{x,y:tail.y},tail,end])];
  const length=(points:Point[])=>points.slice(1).reduce((n,b,i)=>n+Math.abs(points[i].x-b.x)+Math.abs(points[i].y-b.y),0);
  const clear=candidates.filter(points=>boxes.every(box=>!routeCrossesBox(points,box))).sort((a,b)=>length(a)-length(b));
  // An illegal hover inside the source card can have no clear route; it remains a red preview.
  const points=clear[0]||candidates[0],ordered=reverse?[...points].reverse():points;
  return {start:reverse?end:start,end:reverse?start:end,points:ordered,d:roundedRoutePath(ordered)};
}
export function routeCrossesBox(points:Point[],box:PreviewBox){
  // Routes are orthogonal. Touching a card border is allowed; entering its interior is not.
  return points.slice(1).some((b,i)=>{const a=points[i];return a.x===b.x?
    a.x>box.x+.5&&a.x<box.x+box.width-.5&&Math.max(a.y,b.y)>box.y+.5&&Math.min(a.y,b.y)<box.y+box.height-.5:
    a.y===b.y&&a.y>box.y+.5&&a.y<box.y+box.height-.5&&Math.max(a.x,b.x)>box.x+.5&&Math.min(a.x,b.x)<box.x+box.width-.5;});
}
export function staleRouteIds(layout:RoutedLayout|null,links:{id:string;source:string;target:string}[],boxes:Map<string,PreviewBox>,movingIds:string[]=[]){
  const changed=new Set(movingIds);
  for(const [id,box] of boxes){const old=layout?.nodes[id];if(old&&(Math.abs(old.x-box.x)>.1||Math.abs(old.y-box.y)>.1))changed.add(id);}
  const obstacles=[...changed].filter(id=>boxes.has(id)).map(id=>({id,box:boxes.get(id)!}));
  return new Set(links.filter(e=>{
    const route=layout?.edges[e.id];if(!route||changed.has(e.source)||changed.has(e.target))return true;
    return obstacles.some(({id,box})=>id!==e.source&&id!==e.target&&routeCrossesBox(route.points,box));
  }).map(e=>e.id));
}
