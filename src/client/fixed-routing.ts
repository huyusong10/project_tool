import type {LayoutNode,Point} from './path-layout';
export type PositionedNode=LayoutNode&Point;
type Box={left:number;right:number;top:number;bottom:number};
const box=(n:PositionedNode,pad=12):Box=>({left:n.x-pad,right:n.x+n.width+pad,top:n.y-pad,bottom:n.y+n.height+pad});
const intersects=(a:Box,b:Box)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
export function vacantPosition(nodes:PositionedNode[],id:string,position:Point,width=244,height=154):Point{
  const occupied=nodes.filter(n=>n.id!==id).map(n=>box(n,8));
  const free=(p:Point)=>!occupied.some(b=>intersects(box({id,...p,width,height},0),b));
  if(free(position))return position;
  for(let ring=1;ring<200;ring++)for(const [x,y] of [[ring,0],[0,ring],[-ring,0],[0,-ring],[ring,ring],[-ring,ring],[ring,-ring],[-ring,-ring]]){const p={x:position.x+x*16,y:position.y+y*16};if(free(p))return p;}
  return {x:position.x,y:Math.max(0,...nodes.map(n=>n.y+n.height))+32};
}
export function vacantGroup(nodes:PositionedNode[],positions:Record<string,Point>,copy=false):Record<string,Point>{
 const moving=Object.entries(positions).map(([id,p])=>({width:244,height:180,...nodes.find(n=>n.id===id),...p,id})),occupied=nodes.filter(n=>copy||!positions[n.id]).map(n=>box(n,8));
 const free=(dx:number,dy:number)=>moving.every(n=>!occupied.some(b=>intersects(box({...n,x:n.x+dx,y:n.y+dy},0),b)));
 if(free(0,0))return positions;
 for(let ring=1;ring<300;ring++)for(const [x,y] of [[ring,0],[0,ring],[-ring,0],[0,-ring],[ring,ring],[-ring,ring]])if(free(x*16,y*16))return Object.fromEntries(Object.entries(positions).map(([id,p])=>[id,{x:p.x+x*16,y:p.y+y*16}]));
 const dy=Math.max(0,...nodes.map(n=>n.y+n.height))+32-Math.min(...moving.map(n=>n.y));return Object.fromEntries(Object.entries(positions).map(([id,p])=>[id,{x:p.x,y:p.y+dy}]));
}
export {routeOrthogonalGraph as routeFixedGraph} from './orthogonal-routing';
