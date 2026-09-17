import { featurePathGraph } from '../../shared/feature-projection';
import { stableGraphLayout } from '../../shared/graph-layout';
import { routeOrthogonalGraph } from '../../shared/orthogonal-routing';
import { type RoutedLayout } from '../../shared/path-layout';
import { projectPathGraph, type GraphLink } from '../../shared/path-projection';
import { arrangePhaseRegions, featurePhaseLayout, PHASE_HEADER, type PhaseRegion } from '../../shared/phase-layout';
import { pathGraphQuerySchema } from '../../shared/query-contracts';
import type { AuthorizationActor } from '../authorization';
import { getDatabaseContext } from '../database-context';
import { fail, notFound } from '../errors';
import { withFeatureContext } from './feature-context';
import { getFeatureOverview } from './feature-overview';
import { readFeatureRelations } from './features';
import { exportCardSize, graphSvg } from './path-graph-export';
import { loadPathInput, readPathAnalysis } from './paths';

function neighborhood(root: string, links: GraphLink[], direction: 'upstream' | 'downstream', depth: number) {
  const neighbors = new Map<string, string[]>();
  for (const edge of links) {
    const [from, to] = direction === 'upstream' ? [edge.target, edge.source] : [edge.source, edge.target];
    const group = neighbors.get(from) || [];
    group.push(to); neighbors.set(from, group);
  }
  const seen = new Set([root]); let frontier = [root];
  for (let step = 0; step < depth && frontier.length; step++) {
    const next: string[] = [];
    for (const id of frontier) for (const child of neighbors.get(id) || []) if (!seen.has(child)) { seen.add(child); next.push(child); }
    frontier = next;
  }
  return seen;
}

/** The same projection as the web canvas; exports never save positions or change facts. */
export async function readPathGraph(raw: unknown, actor: AuthorizationActor) {
  const input = pathGraphQuerySchema.parse(raw);
  const featureView=input.view==='features'||input.view==='feature';
  const {analysis,graph,overview,relations}=getDatabaseContext().sqlite.transaction(()=>{
    let analysis=readPathAnalysis(input.projectId,undefined,actor);
    if(input.requirementId&&!analysis.requirements.some(r=>r.id===input.requirementId))notFound('需求不存在');
    const target=input.target||(input.requirementId?'acceptance:'+input.requirementId:'project');
    if(target!=='project')analysis=readPathAnalysis(input.projectId,target,actor);
    const requirements=loadPathInput(input.projectId,analysis.asOfDate).requirements;
    const overview=getFeatureOverview(input.projectId,actor,analysis.asOfDate,'all');
    const relations=readFeatureRelations(input.projectId);
    analysis=withFeatureContext(analysis,requirements,actor,{overview,relations});
    if(input.featureId&&input.featureId!=='unassigned'&&!overview?.features.some(g=>g.id===input.featureId))notFound('特性不存在');
    const graph=featureView?featurePathGraph(analysis,overview,relations,requirements,input.featureId,input.planning,input.actual):projectPathGraph(analysis,input.requirementId,input.attention);
    return {analysis,graph,overview,relations};
  })();
  const ids = new Set(graph.cards.map(c => c.id));
  if (input.rootNodeId && !ids.has(input.rootNodeId)) notFound('当前视图中没有该节点，请使用视图返回的节点 ID');
  let visible = ids;
  if (input.rootNodeId) {
    visible = new Set<string>();
    for (const direction of input.traversal === 'both' ? ['upstream', 'downstream'] as const : [input.traversal])
      for (const id of neighborhood(input.rootNodeId, graph.links, direction, input.depth)) visible.add(id);
  }
  if (input.q) {
    const q = input.q.toLocaleLowerCase();
    visible = new Set(graph.cards.filter(c => visible.has(c.id) && (c.title + ' ' + c.subtitle).toLocaleLowerCase().includes(q)).map(c => c.id));
  }
  if(input.phaseId){
    const feature=overview?.features.find(f=>f.id===input.featureId);
    if(input.phaseId!=='unassigned'&&!feature?.phases?.some(p=>p.id===input.phaseId))notFound('Phase 不属于当前特性');
    const matching=new Set(graph.cards.filter(c=>visible.has(c.id)&&!c.external&&(c.phaseId||'unassigned')===input.phaseId).map(c=>c.id));visible=new Set(matching);
    for(const edge of graph.links)if(matching.has(edge.source)||matching.has(edge.target)){visible.add(edge.source);visible.add(edge.target);}
  }
  const phaseRegions=input.view==='feature'?[...(overview?.features.find(f=>f.id===input.featureId)?.phases||[]).map(({id,name,scope,status,targetDate,sortOrder})=>({id,name,scope,status,targetDate,sortOrder,layoutScope:'feature-phase:'+input.featureId+':'+id,nodeIds:graph.cards.filter(c=>!c.external&&c.phaseId===id).map(c=>c.id)})),{id:'unassigned',name:'未分派阶段',scope:'',layoutScope:'feature-phase:'+input.featureId+':unassigned',nodeIds:graph.cards.filter(c=>!c.external&&!c.phaseId).map(c=>c.id)}]:undefined;
  const cards = graph.cards.filter(c => visible.has(c.id)).map(c => ({ ...c, hiddenCount: c.hiddenCount + graph.links.filter(e =>
    e.source === c.id && !visible.has(e.target) || e.target === c.id && !visible.has(e.source)).length }));
  const links = graph.links.filter(e => visible.has(e.source) && visible.has(e.target));
  if (cards.length > input.maxNodes) fail('视图节点过多，请指定需求、根节点、深度或关键词缩小范围', 'VALIDATION_ERROR', 400, { totalNodes: cards.length, maxNodes: input.maxNodes });
  const scope = input.view==='features'?'features':input.featureId?'feature:'+input.featureId:input.requirementId ? 'requirement:' + input.requirementId : 'global';
  const saved = analysis.layouts?.find(l => l.scope === scope && l.direction === input.direction);
  const savedPositions = Object.entries(saved?.positions || {});
  const visiblePositions = savedPositions.filter(([id]) => visible.has(id));
  const savedLayout = { scope, direction: input.direction, version: saved?.version || 0,
    positions: Object.fromEntries(visiblePositions), omittedPositions: savedPositions.length - visiblePositions.length };
  let layout: RoutedLayout | undefined;
  let regions:PhaseRegion[]=[];
  const nodeSizes=cards.map(exportCardSize);
  if (input.layout === 'auto' || input.format === 'svg') {
    if (cards.length > 200 || links.length > 1000) fail('自动布局与 SVG 导出最多支持 200 个节点、1000 条关系，请缩小范围');
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    // The bundled Node engine runs in-process and does not allocate a Web Worker.
    const engine = new ELK();
    if(input.view==='feature'){
      const feature=overview?.features.find(f=>f.id===input.featureId);
      const definitions=featurePhaseLayout(analysis,feature,input.featureId!,cards.map(c=>c.id)).regions;
      const arranged=await arrangePhaseRegions(engine,nodeSizes,links,definitions,{},undefined,true,input.direction==='down');
      regions=arranged.regions;
      layout=routeOrthogonalGraph(nodeSizes.map(n=>({...n,...arranged.positions[n.id]})),links,regions.map(r=>({left:r.x,right:r.x+r.width,top:r.y,bottom:r.y+PHASE_HEADER-16})));
      layout.width=Math.max(layout.width,...regions.map(r=>r.x+r.width+24));
      layout.height=Math.max(layout.height,...regions.map(r=>r.y+r.height+24));
    }else layout = await stableGraphLayout(engine,nodeSizes,links,input.direction==='down',null);
  }
  return { projectId: analysis.projectId, revision: analysis.revision, asOfDate: analysis.asOfDate,
    target: analysis.target, view: input.view, requirementId: input.requirementId || null,
    analysis,...(featureView?{featureId:input.featureId||null,overview,relations}:{}),
    cards, links,...(phaseRegions?{phaseRegions,phaseId:input.phaseId||null}:{}), totalNodes: graph.cards.length, omittedNodes: graph.cards.length - cards.length, savedLayout,
    ...(layout ? { layout: { ...layout,nodeWidth:280,nodeHeight:116,nodeSizes:Object.fromEntries(nodeSizes.map(n=>[n.id,{width:n.width,height:n.height}])),regions } } : {}),
    ...(input.format === 'svg' ? { mimeType: 'image/svg+xml', svg: graphSvg(cards,links,layout!,analysis.projectName,regions) } : {}),
  };
}
