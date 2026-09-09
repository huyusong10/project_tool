export type Arrangement = 'early' | 'late';
export type ScheduleEntry = { id: string; start: number; finish: number; duration: number; arrangement?: Arrangement; anchor?: string | null; movable: boolean; reliable: boolean };
/** Move only within the earliest network's delivery boundaries. Never lengthen a delivery. */
export function arrangeLate(order: string[], entries: ScheduleEntry[], edges: Array<{source:string;target:string}>) {
  const byId=new Map(entries.map(n=>[n.id,n]));
  const next=new Map(order.map(id=>[id,[] as string[]]));
  for(const e of edges)next.get(e.source)!.push(e.target);
  const latest=new Map<string,number>(),reliable=new Map<string,boolean>();
  for(const id of [...order].reverse()){
    const n=byId.get(id)!,children=next.get(id)!;
    reliable.set(id,n.reliable&&children.every(c=>reliable.get(c)));
    latest.set(id,children.length?Math.min(...children.map(c=>latest.get(c)!-byId.get(c)!.duration)):n.finish);
  }
  const result=new Map(entries.map(n=>[n.id,{start:n.start,finish:n.finish,buffer:reliable.get(n.id)?Math.max(0,latest.get(n.id)!-n.finish):null}]));
  for(const id of [...order].reverse()){
    const n=byId.get(id)!,value=result.get(id)!;
    if(n.arrangement==='late'&&n.anchor){const seen=new Set<string>(),queue=[id];for(let i=0;i<queue.length;i++)for(const c of next.get(queue[i])||[])if(!seen.has(c)){seen.add(c);queue.push(c);}if(!seen.has(n.anchor))throw new Error('后置安排的交付点必须位于本工作项下游');}
    if(n.arrangement!=='late'||!n.movable||!reliable.get(id))continue;
    const children=next.get(id)!;
    let bound=children.length?Math.min(...children.map(c=>result.get(c)!.start)):n.finish;
    if(n.anchor){
      if(!byId.get(n.anchor)!.reliable){value.buffer=null;continue;}
      bound=Math.min(bound,byId.get(n.anchor)!.finish);
    }
    value.finish=Math.max(n.finish,bound);value.start=value.finish-n.duration;
    value.buffer=Math.max(0,latest.get(id)!-value.finish);
  }
  return result;
}
