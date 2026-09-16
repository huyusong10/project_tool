import type {GraphCard,GraphLink} from '../../shared/path-projection';
import type {LayoutNode,RoutedLayout} from '../../shared/path-layout';
import {roundedRoutePath} from '../../shared/path-layout';
import {phaseStatusLabels} from '../../shared/feature-phases';
import type {PhaseRegion} from '../../shared/phase-layout';

const xml=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[c]!);
function lines(value:string,width=34,max=3) {
  const result:string[]=[];let line='',size=0;
  for(const c of value){const units=c.charCodeAt(0)>255?2:1;if(size+units>width||c==='\n'){result.push(line);line='';size=0;}if(c!=='\n'){line+=c;size+=units;}}
  if(line)result.push(line);
  return result.length>max?[...result.slice(0,max-1),result[max-1].slice(0,-1)+'…']:result;
}
const titles=(card:GraphCard)=>lines(card.title,34,3);
const subtitles=(card:GraphCard)=>{
  const stage=card.executionStage;
  const summary=stage?.stages.length?stage.stages.length===1?stage.label+' · '+stage.stages[0].progress+'%':stage.stages.map(s=>s.label+' '+s.progress+'%').join(' · ')+'（并行）':stage?.label||card.subtitle;
  return lines(card.kind==='feature'?card.expectation||card.subtitle:summary,38,2);
};
export function exportCardSize(card:GraphCard):LayoutNode {
  return {id:card.id,width:280,height:Math.max(116,24+titles(card).length*20+subtitles(card).length*18+26+(card.phases?.length||0)*24)};
}
const text=(x:number,y:number,value:string,size=12,extra='')=>`<text x="${x}" y="${y}" font-size="${size}" ${extra}>${xml(value)}</text>`;
export function graphSvg(cards:GraphCard[],links:GraphLink[],layout:RoutedLayout,title:string,regions:PhaseRegion[]=[]) {
  const frames=regions.map(r=>{
    const full=[r.name,r.phase?.scope,r.phase?phaseStatusLabels[r.phase.status]:'',r.phase?.targetDate].filter(Boolean).join(' · ');
    const heading=lines(r.name,38,2).map((s,i)=>text(r.x+18,r.y+26+i*20,s,14,'font-weight="600"')).join('');
    const scope=lines(r.phase?.scope||'',44,2).map((s,i)=>text(r.x+18,r.y+72+i*18,s)).join('');
    return `<g data-phase-region="${xml(r.id)}"><title>${xml(full)}</title><rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" rx="10" fill="#f1f5f9" stroke="#cbd5e1"/>${heading}${scope}${text(r.x+18,r.y+124,r.phase?phaseStatusLabels[r.phase.status]+' · 目标 '+(r.phase.targetDate||'待安排'):r.name==='未分派阶段'?'尚未安排交付批次':'保留直接跨范围依赖')}</g>`;
  }).join('');
  const edges=links.map(edge=>{
    const route=layout.edges[edge.id];
    const label=route.label&&edge.label?`<rect x="${route.label.x-4}" y="${route.label.y}" width="${route.label.width+8}" height="22" fill="white"/>${text(route.label.x,route.label.y+15,lines(edge.label,Math.max(6,Math.floor(route.label.width/7)),1)[0]||'')}`:'';
    return `<g><title>${xml(edge.description||edge.label||'')}</title><path d="${roundedRoutePath(route.points)}" fill="none" stroke="${edge.critical?'#c43d35':'#64748b'}" stroke-width="2" stroke-dasharray="${edge.planningOnly?'6 4':'none'}" marker-end="url(#arrow)"/>${label}</g>`;
  }).join('');
  const nodes=cards.map(card=>{
    const p=layout.nodes[card.id],size=exportCardSize(card);let y=25;
    const heading=titles(card).map(s=>{const line=text(14,y,s,14,'font-weight="600"');y+=20;return line;}).join('');
    const detail=subtitles(card).map(s=>{const line=text(14,y+2,s);y+=18;return line;}).join('');
    const facts=card.kind==='feature'?card.phases?.length?'交付批次 '+card.phases.length:card.facts||'尚未关联需求':'预计 '+(card.forecast||'待确认')+' · 余量 '+(card.floatDays??'未知');
    const footer=text(14,y+4,lines(facts,38,1)[0]||'');y+=26;
    const phases=(card.phases||[]).map(phase=>{const line=`<g data-phase="${xml(phase.id)}"><title>${xml(phase.name+' · '+phaseStatusLabels[phase.status])}</title><rect x="12" y="${y-13}" width="256" height="21" rx="4" fill="#e8eef5"/>${text(18,y+2,lines(phase.name,23,1)[0]||'')}${text(204,y+2,phaseStatusLabels[phase.status])}</g>`;y+=24;return line;}).join('');
    return `<g data-card="${xml(card.id)}" transform="translate(${p.x},${p.y})"><title>${xml(card.title+' · '+card.subtitle)}</title><rect width="${size.width}" height="${size.height}" rx="8" fill="${card.external?'#f1f5f9':'#ffffff'}" stroke="${card.critical?'#c43d35':'#94a3b8'}" stroke-width="${card.critical?2:1}"/>${heading}${detail}${footer}${phases}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(layout.width,320)}" height="${Math.max(layout.height,120)}" viewBox="0 0 ${Math.max(layout.width,320)} ${Math.max(layout.height,120)}" role="img"><title>${xml(title)}</title><rect width="100%" height="100%" fill="#f8fafc"/><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/></marker></defs><g font-family="Microsoft YaHei,Arial,sans-serif" fill="#1e293b">${frames}${edges}${nodes}</g></svg>`;
}
