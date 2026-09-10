import {useEffect,useMemo,useState} from 'react';
import '@xyflow/react/dist/style.css';
import {ReactFlow,ReactFlowProvider,Background,Controls,MiniMap,applyNodeChanges,Position,MarkerType,type Node,type Edge,type Connection} from '@xyflow/react';
import type {DraftContent} from '../../shared/requirement-drafts';
import {startId,acceptanceId,dependencySource,dependencyTarget,type PathAnalysis,type PathInput} from '../../shared/paths';
import {randomUUID} from '../random-uuid';

type Endpoint={requirementId:string;workItemId:string|null;milestoneId?:string|null};
type NodeData=Record<string,unknown>&{label:string;kind:string;endpoint:Endpoint};
type Props={content:DraftContent;analysis?:PathAnalysis;project?:PathInput;readonly:boolean;onChange:(content:DraftContent)=>void};
export function DraftTopology(props:Props){return <ReactFlowProvider><Topology {...props}/></ReactFlowProvider>;}
function Topology({content,analysis,project,readonly,onChange}:Props){
  const [source,setSource]=useState(''),[target,setTarget]=useState(''),[error,setError]=useState('');
  const graph=useMemo(()=>{
    const nodes=new Map<string,NodeData>(),edges:Edge[]=[];
    const put=(id:string,title:string,kind:string,endpoint:Endpoint,formal=false)=>nodes.set(id,{label:(formal?'正式 · ':'')+title,kind,endpoint});
    const formal=new Set([...(project?.requirements.map(r=>r.id)||[]),...(project?.workItems.map(w=>w.id)||[]),...(project?.milestones?.map(m=>m.id)||[])]);
    if(analysis){for(const n of analysis.nodes.filter(n=>n.kind!=='project'&&formal.has(n.workItemId||n.requirementId||n.id)))put(n.id,n.title+(n.unknownReasons.length?' · 待确认':''),n.kind,{requirementId:n.requirementId||'',workItemId:n.workItemId,milestoneId:n.kind==='milestone'?n.id:null},true);for(const e of analysis.edges.filter(e=>nodes.has(e.source)&&nodes.has(e.target)))edges.push({id:e.id,source:e.source,target:e.target,style:{stroke:e.critical?'#b94934':'#a5b0bc'},animated:false});}
    // The editable draft is drawn even while its last saved preview is absent or invalid.
    for(const r of content.entities.filter(e=>e.entity==='requirement')){
      const endpoint={requirementId:r.id,workItemId:null};put(startId(r.id),r.data.title+' · 开始','start',endpoint);put(acceptanceId(r.id),r.data.title+' · 验收','acceptance',endpoint);
      const works=content.entities.filter(w=>w.entity==='work'&&w.requirementId===r.id);
      if(!works.length){const id='execute:'+r.id;put(id,r.data.title,'execution',endpoint);edges.push({id:id+':start',source:startId(r.id),target:id},{id:id+':end',source:id,target:acceptanceId(r.id)});}
      for(const w of works){put(w.id,w.data.title,'work',{requirementId:r.id,workItemId:w.id});edges.push({id:w.id+':start',source:startId(r.id),target:w.id},{id:w.id+':end',source:w.id,target:acceptanceId(r.id)});}
    }
    for(const m of content.entities.filter(e=>e.entity==='milestone'))put(m.id,m.data.title,'milestone',{requirementId:m.requirementId||'',workItemId:null,milestoneId:m.id});
    for(const e of content.dependencies){const d={...e,id:e.clientId,projectId:'',origin:'manual'},source=dependencySource(d),target=dependencyTarget(d);if(!nodes.has(source))put(source,'已有成果 '+(e.sourceWorkItemId||e.sourceMilestoneId||e.sourceRequirementId),'external',{requirementId:e.sourceRequirementId,workItemId:e.sourceWorkItemId,milestoneId:e.sourceMilestoneId},true);if(!nodes.has(target))put(target,'已有成果 '+(e.targetWorkItemId||e.targetMilestoneId||e.targetRequirementId),'external',{requirementId:e.targetRequirementId,workItemId:e.targetWorkItemId,milestoneId:e.targetMilestoneId},true);edges.push({id:e.clientId,source,target,style:{stroke:'#26796c',strokeWidth:2},label:'前置'});}
    for(const ref of content.references){
      if(ref.entity==='requirement'){const title=project?.requirements.find(r=>r.id===ref.id)?.title||ref.id;if(!nodes.has(startId(ref.id)))put(startId(ref.id),title+' · 开始','start',{requirementId:ref.id,workItemId:null},true);if(!nodes.has(acceptanceId(ref.id)))put(acceptanceId(ref.id),title+' · 验收','acceptance',{requirementId:ref.id,workItemId:null},true);}
      else if(ref.entity==='work'){const work=project?.workItems.find(w=>w.id===ref.id);if(work&&!nodes.has(work.id))put(work.id,work.title,'work',{requirementId:work.requirementId,workItemId:work.id},true);}
      else {const m=project?.milestones?.find(m=>m.id===ref.id);if(m&&!nodes.has(m.id))put(m.id,m.title,'milestone',{requirementId:m.requirementId||'',workItemId:null,milestoneId:m.id},true);}
    }
    const unique=[...new Map(edges.filter(e=>nodes.has(e.source)&&nodes.has(e.target)).map(e=>[e.source+'→'+e.target,e])).values()];
    const degrees=new Map([...nodes.keys()].map(id=>[id,0])),levels=new Map<string,number>();
    for(const e of unique)degrees.set(e.target,(degrees.get(e.target)||0)+1);
    const queue=[...degrees].filter(([,d])=>!d).map(([id])=>id);
    for(let i=0;i<queue.length;i++){const id=queue[i];for(const e of unique.filter(e=>e.source===id)){levels.set(e.target,Math.max(levels.get(e.target)||0,(levels.get(id)||0)+1));degrees.set(e.target,degrees.get(e.target)!-1);if(!degrees.get(e.target))queue.push(e.target);}}
    const rows=new Map<number,number>();
    const flowNodes:Node<NodeData>[]=[...nodes].map(([id,data])=>{const level=levels.get(id)||0,row=rows.get(level)||0;rows.set(level,row+1);return {id,data,position:content.positions[id]||{x:level*270,y:row*120},sourcePosition:Position.Right,targetPosition:Position.Left,style:{width:225,borderColor:data.kind==='milestone'?'#9d6c28':'#91b9b0',background:'var(--bg-surface)',color:'var(--text-primary)'},connectable:!readonly};});
    return {nodes:flowNodes,edges:unique};
  },[content,analysis,project,readonly]);
  const [nodes,setNodes]=useState(graph.nodes);
  useEffect(()=>setNodes(graph.nodes),[graph.nodes]);
  function connect(connection:Connection){
    const a=graph.nodes.find(n=>n.id===connection.source)?.data,b=graph.nodes.find(n=>n.id===connection.target)?.data;
    if(!a||!b)return;if(a.kind==='start'||b.kind==='acceptance'){setError('前置从具体工作或验收成果出发，指向具体工作或需求开始。');return;}
    if(graph.edges.some(e=>e.source===connection.source&&e.target===connection.target)){setError('这条关系已经存在。');return;}
    setError('');onChange({...content,dependencies:[...content.dependencies,{clientId:randomUUID(),sourceRequirementId:a.endpoint.requirementId,sourceWorkItemId:a.endpoint.workItemId,sourceMilestoneId:a.endpoint.milestoneId,targetRequirementId:b.endpoint.requirementId,targetWorkItemId:b.endpoint.workItemId,targetMilestoneId:b.endpoint.milestoneId}]});
  }
  return <div className="draft-stack"><p>连线表示完成前置后才可开始；无连线的工作可并行。工作项使用具体端点，共享成果只创建一次。拖动位置仅保存在本草稿。</p>{!analysis&&<p>当前显示草稿关系。保存并校验后，显示与正式项目合并的完整网络。</p>}
    <div className="draft-toolbar"><select aria-label="前置成果" disabled={readonly} value={source} onChange={e=>setSource(e.target.value)}><option value="">选择前置成果</option>{graph.nodes.filter(n=>n.data.kind!=='start').map(n=><option key={n.id} value={n.id}>{n.data.label}</option>)}</select><select aria-label="后置工作" disabled={readonly} value={target} onChange={e=>setTarget(e.target.value)}><option value="">选择后置工作或需求开始</option>{graph.nodes.filter(n=>n.data.kind!=='acceptance').map(n=><option key={n.id} value={n.id}>{n.data.label}</option>)}</select><button disabled={readonly||!source||!target} onClick={()=>connect({source,target,sourceHandle:null,targetHandle:null})}>添加前置关系</button></div>
    {error&&<p role="alert">{error}</p>}
    <div className="draft-graph"><ReactFlow nodes={nodes} edges={graph.edges} defaultEdgeOptions={{type:'smoothstep',markerEnd:{type:MarkerType.ArrowClosed}}} onNodesChange={changes=>setNodes(old=>applyNodeChanges(changes,old))} onNodeDragStop={(_,node)=>!readonly&&onChange({...content,positions:{...content.positions,[node.id]:node.position}})} onConnect={connect} nodesDraggable={!readonly} nodesConnectable={!readonly} deleteKeyCode={null} fitView minZoom={0.08} maxZoom={2}><Background/><Controls/><MiniMap pannable zoomable/></ReactFlow></div>
    <section className="draft-card"><h3>明确建立的依赖（{content.dependencies.length}）</h3>{content.dependencies.map(e=>{const d={...e,id:e.clientId,projectId:'',origin:'manual'};return <div className="draft-toolbar" key={e.clientId}><span>{graph.nodes.find(n=>n.id===dependencySource(d))?.data.label} → {graph.nodes.find(n=>n.id===dependencyTarget(d))?.data.label}</span><button disabled={readonly} onClick={()=>onChange({...content,dependencies:content.dependencies.filter(v=>v.clientId!==e.clientId)})}>移除此前置</button></div>;})}</section>
  </div>;
}
