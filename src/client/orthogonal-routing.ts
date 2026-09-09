import type {LayoutEdge, LayoutNode, Point, RoutedLayout} from './path-layout';

type Node = LayoutNode & Point;
type Box = {left:number; right:number; top:number; bottom:number};
type Segment = {a:Point; b:Point};
type Side = 'left'|'right'|'top'|'bottom';
type Endpoint = {node:Node; side:Side; other:Node; point:Point};
const padding=10, stub=28, laneGap=12;
const bounds=(n:Node):Box=>({left:n.x-padding,right:n.x+n.width+padding,top:n.y-padding,bottom:n.y+n.height+padding});
const intersects=(a:Box,b:Box)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
const horizontal=(s:Segment)=>s.a.y===s.b.y;
const length=(a:Point,b:Point)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const segments=(points:Point[]):Segment[]=>points.slice(1).map((b,i)=>({a:points[i],b}));
function clear(a:Point,b:Point,boxes:Box[]){
  return (a.x===b.x||a.y===b.y)&&!boxes.some(r=>a.y===b.y
    ? a.y>r.top&&a.y<r.bottom&&Math.max(a.x,b.x)>r.left&&Math.min(a.x,b.x)<r.right
    : a.x>r.left&&a.x<r.right&&Math.max(a.y,b.y)>r.top&&Math.min(a.y,b.y)<r.bottom);
}
function simplify(points:Point[]){
  const result:Point[]=[];
  for(const p of points){
    if(result.length&&length(result.at(-1)!,p)<.01)continue;
    while(result.length>1){const a=result.at(-2)!,b=result.at(-1)!;
      if((a.x===b.x&&b.x===p.x||a.y===b.y&&b.y===p.y)&&length(a,p)>=length(a,b))result.pop();else break;
    }
    result.push(p);
  }
  return result;
}
function penalty(s:Segment,occupied:Segment[]){
  let cost=0;
  for(const other of occupied){
    if(horizontal(s)===horizontal(other)){
      const h=horizontal(s),distance=Math.abs((h?s.a.y:s.a.x)-(h?other.a.y:other.a.x));
      if(distance>=laneGap)continue;
      const overlap=Math.min(Math.max(h?s.a.x:s.a.y,h?s.b.x:s.b.y),Math.max(h?other.a.x:other.a.y,h?other.b.x:other.b.y))
        -Math.max(Math.min(h?s.a.x:s.a.y,h?s.b.x:s.b.y),Math.min(h?other.a.x:other.a.y,h?other.b.x:other.b.y));
      if(overlap>0)cost+=overlap*(distance<1?8:2)*(1-distance/laneGap);
    }else{
      const h=horizontal(s)?s:other,v=horizontal(s)?other:s;
      if(v.a.x>Math.min(h.a.x,h.b.x)&&v.a.x<Math.max(h.a.x,h.b.x)&&h.a.y>Math.min(v.a.y,v.b.y)&&h.a.y<Math.max(v.a.y,v.b.y))cost+=100;
    }
  }
  return cost;
}
function gridRoute(a:Point,b:Point,boxes:Box[]):Point[]{
  const xs=[...new Set([a.x,b.x,...boxes.flatMap(r=>[r.left,r.right])])].sort((a,b)=>a-b);
  const ys=[...new Set([a.y,b.y,...boxes.flatMap(r=>[r.top,r.bottom])])].sort((a,b)=>a-b);
  type Step={x:number;y:number;direction:number;cost:number;score:number;parent?:Step};
  const queue:Step[]=[],costs=new Map<string,number>();
  const push=(n:Step)=>{queue.push(n);let i=queue.length-1;while(i){const p=(i-1)>>1;if(queue[p].score<=n.score)break;queue[i]=queue[p];i=p;}queue[i]=n;};
  const pop=()=>{const first=queue[0],last=queue.pop()!;if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&queue[child+1].score<queue[child].score)child++;if(queue[child].score>=last.score)break;queue[i]=queue[child];i=child;}queue[i]=last;}return first;};
  push({x:xs.indexOf(a.x),y:ys.indexOf(a.y),direction:0,cost:0,score:0});let examined=0;
  while(queue.length&&examined++<50000){
    const n=pop(),p={x:xs[n.x],y:ys[n.y]};
    if(p.x===b.x&&p.y===b.y){const result:Point[]=[];let step:Step|undefined=n;while(step){result.push({x:xs[step.x],y:ys[step.y]});step=step.parent;}return simplify(result.reverse());}
    for(const [dx,dy,direction] of [[1,0,1],[-1,0,1],[0,1,2],[0,-1,2]]){
      const x=n.x+dx,y=n.y+dy;if(x<0||x>=xs.length||y<0||y>=ys.length)continue;
      const q={x:xs[x],y:ys[y]};if(!clear(p,q,boxes))continue;
      const cost=n.cost+length(p,q)+(n.direction&&n.direction!==direction?28:0),key=x+':'+y+':'+direction;
      if((costs.get(key)??Infinity)<=cost)continue;costs.set(key,cost);push({x,y,direction,cost,score:cost+length(q,b),parent:n});
    }
  }
  throw new Error('节点间距不足，部分连线尚未更新。请拉开节点间距或自动整理。');
}
const cache=new Map<string,{signature:string;points:Point[]}>();
/** Initial layout and manual editing share ports, clearance and lane selection. */
export function routeOrthogonalGraph(nodes:Node[],edges:LayoutEdge[]):RoutedLayout{
  const byId=new Map(nodes.map(n=>[n.id,n])),boxes=nodes.map(bounds),groups=new Map<string,Endpoint[]>(),endpoints=new Map<string,[Endpoint,Endpoint]>();
  const outside=(e:Endpoint,distance=stub):Point=>({...e.point,x:e.point.x+(e.side==='right'?distance:e.side==='left'?-distance:0),y:e.point.y+(e.side==='bottom'?distance:e.side==='top'?-distance:0)});
  for(const edge of edges){
    const source=byId.get(edge.source),target=byId.get(edge.target);if(!source||!target)throw new Error('依赖端点未显示，请刷新分析。');
    // Forward and return relations keep their semantic direction. Vertically stacked cards use vertical ports.
    const stacked=Math.abs(target.x+target.width/2-source.x-source.width/2)<Math.min(source.width,target.width)/2&&Math.abs(target.y-source.y)>Math.min(source.height,target.height);
    const down=target.y>=source.y;
    const pair:[Endpoint,Endpoint]=[{node:source,other:target,side:stacked?(down?'bottom':'top'):'right',point:{x:0,y:0}},
      {node:target,other:source,side:stacked?(down?'top':'bottom'):'left',point:{x:0,y:0}}];
    endpoints.set(edge.id,pair);
    for(const e of pair){const key=e.node.id+':'+e.side;groups.set(key,[...groups.get(key)||[],e]);}
  }
  for(const group of groups.values()){
    const h=group[0].side==='left'||group[0].side==='right';
    group.sort((a,b)=>(h?a.other.y+a.other.height/2-b.other.y-b.other.height/2:a.other.x+a.other.width/2-b.other.x-b.other.width/2)||(h?a.other.x-b.other.x:a.other.y-b.other.y)||a.other.id.localeCompare(b.other.id));
    const size=h?group[0].node.height:group[0].node.width,span=Math.min(size-48,(group.length-1)*20);
    group.forEach((e,i)=>{const offset=size/2+(group.length===1?0:span*(i/(group.length-1)-.5));e.point={x:e.node.x+(h?(e.side==='right'?e.node.width:0):offset),y:e.node.y+(h?offset:e.side==='bottom'?e.node.height:0)};});
  }
  const layout:RoutedLayout={nodes:Object.fromEntries(nodes.map(n=>[n.id,{x:n.x,y:n.y}])),edges:{},width:Math.max(0,...nodes.map(n=>n.x+n.width))+24,height:Math.max(0,...nodes.map(n=>n.y+n.height))+24};
  const occupied:Segment[]=[],labels:Box[]=[];
  const ordered=[...edges].sort((a,b)=>Number(cache.has(b.id))-Number(cache.has(a.id))||byId.get(a.source)!.x-byId.get(b.source)!.x||byId.get(a.source)!.y-byId.get(b.source)!.y||a.id.localeCompare(b.id));
  for(const edge of ordered){
    const [source,target]=endpoints.get(edge.id)!,a=source.point,b=target.point;
    const lead=(e:Endpoint)=>{const obstacles=nodes.filter(n=>n.id!==e.node.id).map(bounds);for(const distance of [stub,20,12]){const p=outside(e,distance);if(clear(e.point,p,obstacles))return p;}throw new Error('连接点被其他节点遮挡，请拉开节点间距。');};
    const direct=(source.side==='right'&&target.side==='left'&&a.y===b.y&&b.x>a.x||source.side==='bottom'&&target.side==='top'&&a.x===b.x&&b.y>a.y||source.side==='top'&&target.side==='bottom'&&a.x===b.x&&b.y<a.y)&&clear(a,b,nodes.filter(n=>n.id!==source.node.id&&n.id!==target.node.id).map(bounds));
    const ap=direct?a:lead(source),bp=direct?b:lead(target),signature=JSON.stringify([a,b,ap,bp,source.node.width,source.node.height,target.node.width,target.node.height]),old=cache.get(edge.id);
    const valid=(ps:Point[])=>segments(ps).every(s=>clear(s.a,s.b,boxes));
    let points:Point[];
    if(direct)points=[a,b];
    else if(old?.signature===signature&&valid(old.points.slice(1,-1))&&segments(old.points).every(s=>clear(s.a,s.b,nodes.filter(n=>n.id!==source.node.id&&n.id!==target.node.id).map(bounds))))points=old.points;
    else{
      const mid={x:(ap.x+bp.x)/2,y:(ap.y+bp.y)/2};
      const nearby=(values:number[],center:number)=>[...new Set(values)].sort((a,b)=>Math.abs(a-center)-Math.abs(b-center)).slice(0,14);
      const xs=nearby([mid.x,ap.x,bp.x,...boxes.flatMap(r=>[r.left-laneGap,r.right+laneGap])],mid.x);
      const ys=nearby([mid.y,ap.y,bp.y,...boxes.flatMap(r=>[r.top-laneGap,r.bottom+laneGap])],mid.y);
      const candidates:Point[][]=[];
      for(const x of xs)candidates.push([ap,{x,y:ap.y},{x,y:bp.y},bp]);
      for(const y of ys)candidates.push([ap,{x:ap.x,y},{x:bp.x,y},bp]);
      let best:Point[]|undefined,bestCost=Infinity;
      for(const candidate of candidates){
        const ps=simplify(candidate);if(!valid(ps))continue;
        const full=simplify([a,...ps,b]);
        // A lead must not double back into itself at either card.
        if(segments(full).some((s,i,all)=>i>0&&horizontal(s)===horizontal(all[i-1])&&length(all[i-1].a,s.b)<length(all[i-1].a,s.a)))continue;
        const cost=segments(ps).reduce((v,s)=>v+length(s.a,s.b)+penalty(s,occupied),0)+Math.max(0,ps.length-2)*28;
        if(cost<bestCost){bestCost=cost;best=ps;}
      }
      points=simplify([a,...best||gridRoute(ap,bp,boxes),b]);
    }
    cache.set(edge.id,{signature,points});occupied.push(...segments(points));
    layout.edges[edge.id]={points,label:null};
    for(const p of points){layout.width=Math.max(layout.width,p.x+24);layout.height=Math.max(layout.height,p.y+24);}
  }
  for(const edge of ordered){const points=layout.edges[edge.id].points;
    let label:RoutedLayout['edges'][string]['label']=null;
    if(edge.label){
      const width=edge.labelWidth||80;
      for(const s of segments(points).filter(horizontal).sort((a,b)=>length(b.a,b.b)-length(a.a,a.b))){
        if(length(s.a,s.b)<width+32)continue;
        for(const offset of [-25,7,-49,31]){
          const x=(s.a.x+s.b.x-width)/2,y=s.a.y+offset,r={left:x-5,right:x+width+5,top:y-3,bottom:y+23};
          if(![...boxes,...labels].some(b=>intersects(b,r))&&!occupied.some(s=>!clear(s.a,s.b,[r]))){label={x,y,width};labels.push(r);break;}
        }
        if(label)break;
      }
      // Stacked cards can have a purely vertical route. Keep its text horizontal,
      // beside the segment, while checking the same card/line/label obstacles.
      if(!label)for(const s of segments(points).filter(s=>!horizontal(s)).sort((a,b)=>length(b.a,b.b)-length(a.a,a.b))){
        if(length(s.a,s.b)<40)continue;
        const y=(s.a.y+s.b.y)/2-10;
        for(const x of [s.a.x+12,s.a.x-width-12]){
          const r={left:x-5,right:x+width+5,top:y-3,bottom:y+23};
          if(![...boxes,...labels].some(b=>intersects(b,r))&&!occupied.some(s=>!clear(s.a,s.b,[r]))){label={x,y,width};labels.push(r);break;}
        }
        if(label)break;
      }
    }
    layout.edges[edge.id].label=label;
  }
  if(cache.size>4000)cache.clear();return layout;
}
