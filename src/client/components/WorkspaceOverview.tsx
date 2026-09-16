import { Button } from './Button';
import {useState} from 'react';
import {addDays,formatISO} from 'date-fns';
import {ChartNoAxesCombined,ArrowUpRight,CheckCheck,Flag,ShieldAlert,Activity} from 'lucide-react';
import {useProjectWorkspace} from '../project-workspace-context';
import {workspaceSummary} from '../workspace-summary';
import {workspaceAncestors} from '../workspace-location';
import {PhaseStatusBadge} from './PhasePlanning';
import {ExecutionStageBadge} from './ExecutionStageBadge';
import {Modal} from './Modal';

export function WorkspaceOverview(){
  const workspace=useProjectWorkspace()!,{location,data}=workspace;
  const [open,setOpen]=useState(false);
  const {ids,requirements,phases,hasPhases,blockers,blockedIds,recentCompleted,inProgress,recentFrom,unphased}=workspaceSummary(location,data);
  const through=formatISO(addDays(new Date(data.asOfDate+'T12:00:00'),30),{representation:'date'});
  const upcoming=phases.filter(p=>!p.deliveredAt&&(p.status==='in_progress'||p.status==='ready'||p.targetDate&&p.targetDate<=through));
  const planned=phases.filter(p=>!p.deliveredAt&&!upcoming.includes(p));
  const complete=requirements.filter(r=>r.status==='completed').length,delivered=phases.filter(p=>p.status==='delivered').length;
  const works=data.nodes.filter(n=>n.kind==='work'&&ids.has(n.requirementId||'')&&n.status!=='cancelled'),workComplete=works.filter(n=>n.status==='completed').length;
  const scopeName=workspaceAncestors(location,data).at(-1)?.label||data.projectName;
  const activate=(action:()=>void)=>{setOpen(false);action();};
  const showPhase=(p:typeof phases[number])=><article className="workspace-overview-phase" key={p.id}>
    <div className="overview-item-heading"><Button variant="link" className="overview-link" onClick={()=>activate(()=>workspace.enter({kind:'phase',id:p.id}))}>{location.scope.kind==='project'?p.featureName+' / ':''}{p.name}<ArrowUpRight size={14}/></Button><PhaseStatusBadge phase={p}/></div>
    <p>{p.scope||'交付范围待明确'}</p><footer><span>{p.requirements.filter(r=>r.status==='completed').length} / {p.requirements.filter(r=>r.status!=='cancelled').length} 条需求完成</span><span className={p.overdue?'danger-text':''}>{p.targetDate||'日期待定'}{p.overdue?' · 已逾期':''}</span></footer>
  </article>;
  const requirementRows=(items:typeof requirements)=>items.map(r=><div className="overview-requirement" key={r.id}><Button variant="link" className="overview-link" onClick={()=>activate(()=>workspace.inspect(r.id))}>{r.title}</Button><ExecutionStageBadge requirement={r}/></div>);
  return <section className="workspace-overview" aria-label="当前范围概览" data-workspace-zone="tools">
    <div className="workspace-overview-strip">
      <div className="workspace-overview-metrics"><span className="workspace-overview-scope" title="统计当前范围全部内容，不随列表筛选变化">范围汇总</span><span className="overview-metric"><CheckCheck size={15}/><span>近7天完成</span><strong>{recentCompleted.length}<small> · 累计 {complete}</small></strong></span><span className="overview-metric"><Activity size={15}/><span>推进中</span><strong>{inProgress.length}</strong></span><span className="overview-metric"><Flag size={15}/><span>{hasPhases?'Phase 交付':'工作项完成'}</span><strong>{hasPhases?delivered:workComplete}<small> / {hasPhases?phases.length:works.length}</small></strong></span><span className={'overview-metric'+(blockedIds.size?' has-blockers':'')}><ShieldAlert size={15}/><span>阻塞需求</span><strong>{blockedIds.size}</strong></span></div>
      <Button variant="secondary" size="small" className="overview-trigger" aria-label="展开概览" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><ChartNoAxesCombined size={16}/><span>概览</span><ArrowUpRight size={14}/></Button>
    </div>
    {open&&<Modal title={'范围概览 · '+scopeName} width={1080} layout="workspace" onClose={()=>setOpen(false)}><div className="workspace-overview-dialog">
      <div className="overview-dialog-summary"><span><strong>{complete} / {requirements.length}</strong>需求完成</span><span><strong>{hasPhases?delivered:workComplete+' / '+works.length}</strong>{hasPhases?'Phase 已交付':'工作项完成'}</span><span><strong>{hasPhases?phases.filter(p=>p.status==='in_progress').length+' / '+phases.filter(p=>p.status==='ready').length:works.filter(n=>n.status==='in_progress').length}</strong>{hasPhases?'推进中 / 待交付':'工作项进行中'}</span><span><strong>{blockedIds.size}</strong>阻塞需求</span></div>
      <div className="workspace-overview-content"><section><h3>近7天完成<small>{recentFrom} ～ {data.asOfDate}</small></h3>{recentCompleted.length?requirementRows(recentCompleted):<p className="overview-empty">近7天没有完成的需求</p>}<h3>{hasPhases?'近期交付':'执行情况'}<small>{hasPhases?'未来 30 天及正在推进':''}</small></h3>
        {hasPhases?<>{upcoming.map(showPhase)}{!upcoming.length&&<p className="overview-empty">没有近期交付批次</p>}{!!planned.length&&<details><summary>后续规划 · {planned.length} 批</summary>{planned.filter(p=>p.targetDate).map(showPhase)}{planned.some(p=>!p.targetDate)&&<><h4>日期待定</h4>{planned.filter(p=>!p.targetDate).map(showPhase)}</>}</details>}{phases.some(p=>p.deliveredAt)&&<details><summary>已交付批次</summary>{phases.filter(p=>p.deliveredAt).map(showPhase)}</details>}</>:requirementRows(requirements)}
        {hasPhases&&(location.scope.kind==='phase'||unphased.length>0)&&<><h3>{location.scope.kind==='phase'?'本批次需求':'未分派阶段'}<small>{location.scope.kind==='phase'?requirements.length:unphased.length} 条需求</small></h3>{requirementRows(location.scope.kind==='phase'?requirements:unphased)}</>}
        {location.scope.kind==='requirement'&&data.nodes.filter(n=>n.requirementId===location.scope.id&&n.kind==='work').map(n=><div className="overview-requirement" key={n.id}><Button variant="link" className="overview-link" onClick={()=>activate(()=>workspace.inspect(n.id))}>{n.title}</Button><span>{n.progress??0}% · 预计 {n.forecastEnd||'待确认'}</span></div>)}
      </section><section><h3>主要阻塞<small>{blockers.length} 个来源</small></h3>{blockers.map(b=><article className="workspace-overview-blocker" key={b.nodeId}>
        <Button variant="link" className="overview-link" onClick={()=>activate(()=>workspace.inspect(b.workItemId||b.requirementId))}>{b.workItemId?((data.requirements.find(r=>r.id===b.requirementId)?.title||'关联需求')+' / '):''}{b.title}</Button>
        <p>{b.reasons.join('；')}</p><div className="overview-blocker-meta"><span>{b.critical?'关键路径 · ':''}影响 {new Set([b.requirementId,...b.affectedRequirementIds].filter(id=>ids.has(id)&&blockedIds.has(id))).size} 条需求</span><Button variant="link" className="overview-link" onClick={()=>activate(()=>workspace.switchView('graph',b.nodeId))}>定位关系图<ArrowUpRight size={14}/></Button></div>
        <details><summary>查看影响需求</summary>{data.requirements.filter(r=>blockedIds.has(r.id)&&[b.requirementId,...b.affectedRequirementIds].includes(r.id)).map(r=><div key={r.id}><Button variant="link" className="overview-link" onClick={()=>activate(()=>workspace.inspect(r.id))}>{r.title}</Button></div>)}</details>
      </article>)}{!blockers.length&&<p className="overview-empty">当前范围没有需要协调的依赖阻塞</p>}</section></div>
      <p className="overview-data-note">统计正式数据，包含归档完成需求的交付贡献；页面筛选不改变概览。</p>
    </div></Modal>}
  </section>;
}
