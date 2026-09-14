import type { AuthorizationActor } from '../authorization';
import { notFound, fail } from '../errors';
import { readPathAnalysis,loadPathInput } from './paths';
import { sqlite } from '../database';
import { getFeatureOverview } from './feature-overview';
import {withFeatureContext} from './feature-context';
import { readFeatureRelations } from './features';
import { featureAssessmentLabels } from '../../shared/intake';
import { featurePathGraph } from '../../shared/feature-projection';
import { pathGraphQuerySchema } from '../../shared/query-contracts';
import { projectPathGraph, type GraphCard, type GraphLink } from '../../shared/path-projection';
import { stableGraphLayout } from '../../shared/graph-layout';
import { roundedRoutePath, type RoutedLayout } from '../../shared/path-layout';

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

const cardWidth = 280, cardHeight = 116;
const xml = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const clip = (value: string, size: number) => Array.from(value).length > size ? Array.from(value).slice(0, size - 1).join('') + '…' : value;

function graphSvg(cards: GraphCard[], links: GraphLink[], layout: RoutedLayout, title: string) {
  const edges = links.map(edge => {
    const route = layout.edges[edge.id];
    return `<g><title>${xml(edge.description || edge.label || '')}</title><path d="${roundedRoutePath(route.points)}" fill="none" stroke="${edge.critical ? '#c43d35' : '#64748b'}" stroke-width="2" stroke-dasharray="${edge.planningOnly?'6 4':'none'}" marker-end="url(#arrow)"/>${route.label && edge.label ? `<rect x="${route.label.x - 4}" y="${route.label.y}" width="${route.label.width + 8}" height="22" fill="white"/><text x="${route.label.x}" y="${route.label.y + 15}" font-size="12">${xml(edge.label)}</text>` : ''}</g>`;
  }).join('');
  const nodes = cards.map(card => {
    const point = layout.nodes[card.id], titleChars = Array.from(card.title);
    return `<g transform="translate(${point.x},${point.y})"><title>${xml(card.title + ' · ' + card.subtitle)}</title><rect width="${cardWidth}" height="${cardHeight}" rx="8" fill="${card.external ? '#f1f5f9' : '#ffffff'}" stroke="${card.critical ? '#c43d35' : '#94a3b8'}" stroke-width="${card.critical ? 2 : 1}"/><text x="14" y="25" font-size="14" font-weight="600">${xml(titleChars.slice(0, 17).join(''))}</text><text x="14" y="45" font-size="14" font-weight="600">${xml(clip(titleChars.slice(17).join(''), 17))}</text><text x="14" y="69" font-size="12">${xml(clip(card.kind==='feature'?(card.assessment?featureAssessmentLabels[card.assessment]+' · ':'')+(card.expectation||'尚未填写预期'):card.subtitle, 20))}</text><text x="14" y="94" font-size="12">${xml(card.kind==='feature'?card.facts||'尚未关联需求':'预计 ' + (card.forecast || '待确认') + ' · 余量 ' + (card.floatDays ?? '未知'))}</text></g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(layout.width, 320)}" height="${Math.max(layout.height, 120)}" viewBox="0 0 ${Math.max(layout.width, 320)} ${Math.max(layout.height, 120)}" role="img"><title>${xml(title)}</title><rect width="100%" height="100%" fill="#f8fafc"/><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs><g font-family="Microsoft YaHei,Arial,sans-serif" fill="#1e293b">${edges}${nodes}</g></svg>`;
}

/** The same projection as the web canvas; exports never save positions or change facts. */
export async function readPathGraph(raw: unknown, actor: AuthorizationActor) {
  const input = pathGraphQuerySchema.parse(raw);
  const featureView=input.view==='features'||input.view==='feature';
  const {analysis,graph,overview,relations}=sqlite.transaction(()=>{
    let analysis=readPathAnalysis(input.projectId,undefined,actor);
    if(input.requirementId&&!analysis.requirements.some(r=>r.id===input.requirementId))notFound('需求不存在');
    const target=input.target||(input.requirementId?'acceptance:'+input.requirementId:'project');
    if(target!=='project')analysis=readPathAnalysis(input.projectId,target,actor);
    analysis=withFeatureContext(analysis,loadPathInput(input.projectId,analysis.asOfDate).requirements,actor);
    const overview=featureView?getFeatureOverview(input.projectId,actor,analysis.asOfDate,'all'):undefined;
    const relations=featureView?readFeatureRelations(input.projectId):undefined;
    if(input.featureId&&input.featureId!=='unassigned'&&!overview?.features.some(g=>g.id===input.featureId))notFound('特性不存在');
    const graph=overview?featurePathGraph(analysis,overview,relations!,loadPathInput(input.projectId,analysis.asOfDate).requirements,input.featureId,input.planning,input.actual):projectPathGraph(analysis,input.requirementId,input.attention);
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
  if (input.layout === 'auto' || input.format === 'svg') {
    if (cards.length > 200 || links.length > 1000) fail('自动布局与 SVG 导出最多支持 200 个节点、1000 条关系，请缩小范围');
    const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
    // The bundled Node engine runs in-process and does not allocate a Web Worker.
    const engine = new ELK();
    layout = await stableGraphLayout(engine, cards.map(c => ({ id: c.id, width: cardWidth, height: cardHeight })), links, input.direction === 'down', null);
  }
  return { projectId: analysis.projectId, revision: analysis.revision, asOfDate: analysis.asOfDate,
    target: analysis.target, view: input.view, requirementId: input.requirementId || null,
    analysis,...(featureView?{featureId:input.featureId||null,overview,relations}:{}),
    cards, links, totalNodes: graph.cards.length, omittedNodes: graph.cards.length - cards.length, savedLayout,
    ...(layout ? { layout: { ...layout, nodeWidth: cardWidth, nodeHeight: cardHeight } } : {}),
    ...(input.format === 'svg' ? { mimeType: 'image/svg+xml', svg: graphSvg(cards, links, layout!, analysis.projectName) } : {}),
  };
}
