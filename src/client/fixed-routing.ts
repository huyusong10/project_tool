import type {LayoutNode,LayoutEdge,Point,RoutedLayout} from './path-layout';
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
function clear(a:Point,b:Point,boxes:Box[]){return !boxes.some(r=>a.y===b.y?a.y>r.top&&a.y<r.bottom&&Math.max(a.x,b.x)>r.left&&Math.min(a.x,b.x)<r.right:a.x>r.left&&a.x<r.right&&Math.max(a.y,b.y)>r.top&&Math.min(a.y,b.y)<r.bottom);}
function simplify(points:Point[]){return points.filter((p,i)=>!i||i===points.length-1||!(points[i-1].x===p.x&&p.x===points[i+1].x||points[i-1].y===p.y&&p.y===points[i+1].y));}
function findRoute(a:Point,b:Point,boxes:Box[]):Point[]{
  for(const via of [{x:b.x,y:a.y},{x:a.x,y:b.y}])if(clear(a,via,boxes)&&clear(via,b,boxes))return simplify([a,via,b]);
  const xs=[...new Set([a.x,b.x,...boxes.flatMap(r=>[r.left,r.right])])].sort((a,b)=>a-b),ys=[...new Set([a.y,b.y,...boxes.flatMap(r=>[r.top,r.bottom])])].sort((a,b)=>a-b);
  type Step={x:number;y:number;direction:number;cost:number;score:number;parent?:Step};
  const queue:Step[]=[],costs=new Map<string,number>();
  const push=(n:Step)=>{queue.push(n);let i=queue.length-1;while(i){const p=(i-1)>>1;if(queue[p].score<=n.score)break;queue[i]=queue[p];i=p;}queue[i]=n;};
  const pop=()=>{const first=queue[0],last=queue.pop()!;if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&queue[child+1].score<queue[child].score)child++;if(queue[child].score>=last.score)break;queue[i]=queue[child];i=child;}queue[i]=last;}return first;};
  push({x:xs.indexOf(a.x),y:ys.indexOf(a.y),direction:0,cost:0,score:0});let examined=0;
  while(queue.length&&examined++<30000){const n=pop(),p={x:xs[n.x],y:ys[n.y]};if(p.x===b.x&&p.y===b.y){const result:Point[]=[];let step:Step|undefined=n;while(step){result.push({x:xs[step.x],y:ys[step.y]});step=step.parent;}return simplify(result.reverse());}
    for(const [dx,dy,direction] of [[1,0,1],[-1,0,1],[0,1,2],[0,-1,2]]){const x=n.x+dx,y=n.y+dy;if(x<0||x>=xs.length||y<0||y>=ys.length)continue;const q={x:xs[x],y:ys[y]};if(!clear(p,q,boxes))continue;
      const cost=n.cost+Math.abs(q.x-p.x)+Math.abs(q.y-p.y)+(n.direction&&n.direction!==direction?24:0),key=x+':'+y+':'+direction;if((costs.get(key)??Infinity)<=cost)continue;costs.set(key,cost);push({x,y,direction,cost,score:cost+Math.abs(q.x-b.x)+Math.abs(q.y-b.y),parent:n});}
  }
  throw new Error('当前节点间距不足，无法完成连线路由，请移动节点或自动整理');
}
const cache=new Map<string,{signature:string;route:RoutedLayout['edges'][string]}>();
export function routeFixedGraph(nodes:PositionedNode[],edges:LayoutEdge[]):RoutedLayout{
  const byId=new Map(nodes.map(n=>[n.id,n])),boxes=nodes.map(n=>box(n)),labels:Box[]=[];
  const layout:RoutedLayout={nodes:Object.fromEntries(nodes.map(n=>[n.id,{x:n.x,y:n.y}])),edges:{},width:Math.max(0,...nodes.map(n=>n.x+n.width))+24,height:Math.max(0,...nodes.map(n=>n.y+n.height))+24};
  for(const e of edges){const source=byId.get(e.source),target=byId.get(e.target);if(!source||!target)continue;
    const sx=source.x+source.width/2,sy=source.y+source.height/2,tx=target.x+target.width/2,ty=target.y+target.height/2,horizontal=Math.abs(tx-sx)>=Math.abs(ty-sy),sign=horizontal?(tx>=sx?1:-1):(ty>=sy?1:-1);
    const a=horizontal?{x:source.x+(sign>0?source.width:0),y:sy}:{x:sx,y:source.y+(sign>0?source.height:0)},b=horizontal?{x:target.x+(sign>0?0:target.width),y:ty}:{x:tx,y:target.y+(sign>0?0:target.height)};
    const ap={x:a.x+(horizontal?sign*12:0),y:a.y+(horizontal?0:sign*12)},bp={x:b.x-(horizontal?sign*12:0),y:b.y-(horizontal?0:sign*12)};
    const signature=JSON.stringify([source,target,e.label,e.labelWidth]),old=cache.get(e.id);
    let points:Point[];
    if(old?.signature===signature&&old.route.points.slice(1,-1).every((p,i,ps)=>!i||clear(ps[i-1],p,boxes)))points=old.route.points;
    else points=simplify([a,...findRoute(ap,bp,boxes),b]);
    let label:RoutedLayout['edges'][string]['label']=null;
    if(e.label){const width=e.labelWidth||80;for(let i=1;i<points.length&&!label;i++){
      const p=points[i-1],q=points[i];if(p.y!==q.y||Math.abs(p.x-q.x)<width+12)continue;
      for(const offset of [-24,6,-48,30]){const x=(p.x+q.x-width)/2,y=p.y+offset,r={left:x-4,right:x+width+4,top:y-2,bottom:y+22};if(![...boxes,...labels].some(b=>intersects(b,r))){label={x,y,width};labels.push(r);break;}}
    }}
    layout.edges[e.id]={points,label};cache.set(e.id,{signature,route:layout.edges[e.id]});
  }
  if(cache.size>4000)cache.clear();return layout;
}
