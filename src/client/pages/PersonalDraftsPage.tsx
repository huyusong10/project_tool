import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useSearchParams,Link} from 'react-router-dom';
import {api,jsonBody} from '../api';
import {useProjects,useSession} from '../app-context';
import {randomUUID} from '../random-uuid';
import {PageHeader} from '../components/PageHeader';
import {DraftModal as Modal} from '../components/DraftModal';
import {ViewTabs} from '../components/ViewTabs';
import {emptyDraftContent,type RequirementDraft,type DraftSummary,type DraftPreview,type DraftReceipt} from '../../shared/requirement-drafts';
import {mergeDraftDocument} from '../../shared/draft-editing';
import {usePersonalDraft} from '../use-personal-draft';
import {DraftContentEditor,type DraftContext} from '../components/DraftContentEditor';
import {DraftTopology} from '../components/DraftTopology';

const base='/api/my/requirement-drafts';
const labels={draft:'草稿',published:'已发布',closed:'已关闭'};
export function PersonalDraftsPage(){
  const {session}=useSession(),{projects,selectedProjectId}=useProjects(),[params,setParams]=useSearchParams();
  const id=params.get('draft'),[project,setProject]=useState(''),[status,setStatus]=useState('draft'),[q,setQ]=useState(''),[page,setPage]=useState(1);
  const [createOpen,setCreateOpen]=useState(false),[target,setTarget]=useState(selectedProjectId||projects[0]?.id||''),[title,setTitle]=useState(''),[error,setError]=useState(''),[creating,setCreating]=useState(false);
  const [createId,setCreateId]=useState(()=>randomUUID());
  const list=useQuery({queryKey:['personal-drafts',session.accountId,project,status,q,page],queryFn:()=>api<{items:DraftSummary[];total:number}>(base+'?'+new URLSearchParams({...(project?{projectId:project}:{}),...(status?{status}:{}),q,page:String(page)})),enabled:!id,refetchInterval:15000});
  const detail=useQuery({queryKey:['personal-draft',session.accountId,id],queryFn:()=>api<RequirementDraft>(base+'/'+id),enabled:!!id,refetchInterval:15000,retry:false});
  const open=(draftId:string)=>setParams(p=>{p.set('space','drafts');p.set('draft',draftId);return p;});
  async function create(){setCreating(true);setError('');try{const d=await api<RequirementDraft>(base,{method:'POST',body:jsonBody({requestId:createId,projectId:target,title:title||'未命名方案',content:emptyDraftContent()})});setCreateOpen(false);setCreateId(randomUUID());open(d.id);}catch(e){setError((e as Error).message);}finally{setCreating(false);}}
  if(id)return <>{detail.error&&<p role="alert">{detail.error.message}</p>}{detail.data?<PersonalDraftEditor key={id} initial={detail.data} onBack={()=>setParams({space:'drafts'})}/>:<p>正在读取个人草稿…</p>}</>;
  return <section className="personal-drafts"><PageHeader title="个人草稿" actions={<button className="primary" onClick={()=>{setCreateOpen(true);setTarget(selectedProjectId||projects[0]?.id||'');}}>新建草稿</button>}/><p>Agent 与你共同整理方案。仅本人可见，网页发布后才写入目标项目。</p>
    <div className="draft-toolbar"><label>项目<select value={project} onChange={e=>{setProject(e.target.value);setPage(1);}}><option value="">全部项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>状态<select value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">全部状态</option>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label><label>搜索草稿<input value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="按标题搜索"/></label></div>
    {list.error&&<p role="alert">{list.error.message}</p>}
    <div className="draft-list">{list.data?.items.map(d=><button className="draft-list-item" key={d.id} onClick={()=>open(d.id)}><strong>{d.title||'未命名方案'}</strong><span>{labels[d.status]} · {projects.find(p=>p.id===d.projectId)?.name||'项目权限不可用'} · {d.source==='mcp'?'Agent / MCP':'网页'}</span><span>{d.requirementCount} 个需求 · {d.workItemCount} 个工作项</span><small>更新于 {new Date(d.updatedAt).toLocaleString()}</small></button>)}</div>
    {list.data?.total===0&&<p>暂无个人草稿。可在此新建，或让 Agent 通过 MCP 推送方案。</p>}
    {(list.data?.total||0)>30&&<div className="draft-toolbar"><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>第 {page} 页</span><button disabled={page*30>=(list.data?.total||0)} onClick={()=>setPage(page+1)}>下一页</button></div>}
    {createOpen&&<Modal title="新建个人草稿" onClose={()=>!creating&&setCreateOpen(false)}><div className="draft-fields"><label>目标项目<select value={target} onChange={e=>{setTarget(e.target.value);setCreateId(randomUUID());}}><option value="">请选择项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>方案标题<input value={title} onChange={e=>{setTitle(e.target.value);setCreateId(randomUUID());}}/></label><p>目标项目创建后固定。普通成员可整理草稿，发布需要项目经理或管理员权限。</p>{error&&<p role="alert">{error}</p>}<button className="primary" disabled={!target||creating} onClick={()=>void create()}>{creating?'创建中…':'创建个人草稿'}</button></div></Modal>}
  </section>;
}

function PersonalDraftEditor({initial,onBack}:{initial:RequirementDraft;onBack:()=>void}){
  const state=usePersonalDraft(initial),{saved,document,edit,dirty}=state,client=useQueryClient();
  const [tab,setTab]=useState('content'),[preview,setPreview]=useState<DraftPreview|null>(null),[plan,setPlan]=useState<DraftPreview|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[publishOpen,setPublishOpen]=useState(false),[closeOpen,setCloseOpen]=useState(false);
  const [choices,setChoices]=useState<Record<string,'local'|'remote'>>({});
  const pendingKey=`personal-draft-publish:${saved.accountId}:${saved.id}`;
  type PublishRequest={batchId:string;expectedVersion:number;projectRevision:number;previewToken:string};
  const [pending,setPending]=useState<PublishRequest|null>(()=>{try{return JSON.parse(localStorage.getItem(pendingKey)||'null');}catch{return null;}});
  const context=useQuery({queryKey:['personal-draft-context',saved.accountId,saved.id],queryFn:()=>api<DraftContext>(base+'/'+saved.id+'/context'),enabled:saved.projectAccessible,retry:false,refetchInterval:15000});
  const readonly=saved.status!=='draft'||!saved.projectAccessible||!!context.error||!!pending||!!state.conflict||!!state.recovery;
  const ready=!readonly&&!dirty&&!state.busy&&state.status==='已保存';
  async function runPreview(kind:'preview'|'plan-preview'){
    setError('');setBusy(true);try{const p=await api<DraftPreview>(base+'/'+saved.id+'/'+kind,{method:'POST',readOnly:true,body:jsonBody({expectedVersion:saved.version})});if(kind==='preview')setPreview(p);else setPlan(p);await context.refetch();}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  useEffect(()=>{setPreview(null);setPlan(null);},[saved.version]);
  async function finish(){const d=await api<RequirementDraft>(base+'/'+saved.id);state.accept(d);setPending(null);localStorage.removeItem(pendingKey);setPublishOpen(false);await client.invalidateQueries();}
  async function publish(retry=false){
    if(!pending&&!preview)return;setError('');setBusy(true);
    const request=pending||{batchId:randomUUID(),expectedVersion:saved.version,projectRevision:preview!.projectRevision,previewToken:preview!.previewToken};
    setPending(request);
    try{localStorage.setItem(pendingKey,JSON.stringify(request));}catch{setError('无法保存发布请求，请恢复浏览器存储后重试。');setPending(null);setBusy(false);return;}
    try{
      if(pending||retry){const receipt=await api<DraftReceipt|{status:'not_found'}>(base+'/'+saved.id+'/receipts/'+request.batchId);if(receipt.status==='applied'){await finish();return;}if(!retry){setError('尚无发布回执。可使用原批次重试，或重新核对。');return;}}
      await api<DraftReceipt>(base+'/'+saved.id+'/publish',{method:'POST',body:jsonBody(request)});await finish();
    }catch(e){setError((e as Error).message+'；保留原请求，请先查询回执。');}finally{setBusy(false);}
  }
  async function clearPending(){setBusy(true);try{const receipt=await api<DraftReceipt|{status:'not_found'}>(base+'/'+saved.id+'/receipts/'+pending!.batchId);if(receipt.status==='applied')await finish();else{setPending(null);localStorage.removeItem(pendingKey);setPreview(null);setPublishOpen(false);}}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function close(){setBusy(true);try{const d=await api<RequirementDraft>(base+'/'+saved.id+'/close',{method:'POST',body:jsonBody({requestId:randomUUID(),expectedVersion:saved.version})});state.accept(d);setCloseOpen(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const currentPreview=tab==='plan'?plan:preview;
  return <section className="personal-drafts"><PageHeader title="个人草稿"/><div className="draft-toolbar"><button onClick={onBack}>返回个人草稿</button><span>{context.data?.project.projectName||'目标项目资料暂不可用'}</span><span>{labels[saved.status]} · 版本 {saved.version}</span><span role="status">{state.status}</span><button disabled={!dirty||readonly||state.busy} onClick={()=>void state.save()}>立即保存 / 重试</button></div>
    <label className="draft-title">方案标题<input value={document.title} disabled={readonly} onChange={e=>edit({...document,title:e.target.value})}/></label>
    {(!saved.projectAccessible||context.error)&&<p role="alert">项目权限或资料不可用，已保存的个人内容仍保留。恢复权限后可继续预览和发布。</p>}
    {(error||state.error)&&<p className="draft-error" role="alert">{error||state.error}</p>}
    {state.recovery&&<div className="draft-notice">发现浏览器中尚未完成的编辑。<button onClick={state.restore}>恢复并与服务端合并</button><button onClick={state.discardRecovery}>使用服务端版本</button></div>}
    {pending&&<div className="draft-notice">发布结果需要核对，批次 {pending.batchId}<div className="draft-toolbar"><button disabled={busy} onClick={()=>void publish()}>查询发布回执</button><button disabled={busy} onClick={()=>void publish(true)}>查询后重试原批次</button><button disabled={busy} onClick={()=>void clearPending()}>核对后返回编辑</button></div></div>}
    {saved.receipt&&<div className="draft-notice"><strong>已发布到正式项目</strong><ul>{saved.content.entities.filter(e=>e.entity==='requirement').map(e=><li key={e.id}><Link to={'/requirements/'+saved.receipt!.ids[e.id]}>{e.data.title}</Link></li>)}</ul><details><summary>临时标识与正式 ID 映射</summary><dl>{Object.entries(saved.receipt.ids).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></details></div>}
    <div className="draft-toolbar"><ViewTabs value={tab} onChange={setTab} options={[{value:'content',label:'需求与来源'},{value:'topology',label:'拓扑'},{value:'plan',label:'计划'}]}/><button disabled={!ready||busy} onClick={()=>void runPreview(tab==='plan'?'plan-preview':'preview')}>{tab==='plan'?'预览完整计划':'校验已保存方案'}</button><button className="primary" disabled={!ready||busy||!saved.canPublish||!preview||preview.draftVersion!==saved.version||!!preview.errors.length} onClick={()=>setPublishOpen(true)}>审核并发布</button><button disabled={!ready||busy} onClick={()=>setCloseOpen(true)}>关闭草稿</button></div>
    {!saved.canPublish&&saved.status==='draft'&&<p>你可以整理和分析方案；发布需要本人拥有目标项目的经理或管理员权限。</p>}
    {dirty&&<p>编辑尚未保存，预览和发布将在保存后可用。</p>}
    {currentPreview?.sourceChanges?.map((change,i)=><details className="draft-card" key={i}><summary>来源差异：{change.title}</summary><div className="draft-conflict"><div>原版本<pre>{change.before}</pre></div><div>本次内容<pre>{change.after}</pre></div></div></details>)}
    {currentPreview&&<div className="draft-notice"><strong>{currentPreview.errors.length?'发布前需解决 '+currentPreview.errors.length+' 项':'该版本校验通过'}</strong>{currentPreview.errors.map((e,i)=><p className="draft-error" key={i}>{e}</p>)}<details><summary>待确认与提示（{currentPreview.warnings.length}）</summary><ul>{currentPreview.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details></div>}
    {tab==='topology'?<DraftTopology content={document.content} project={context.data?.project} analysis={preview?.core?.analysis} readonly={readonly} onChange={content=>edit({...document,content})}/>:<DraftContentEditor tab={tab} draft={saved} content={document.content} context={context.data} readonly={readonly} ready={ready} plan={plan} onChange={content=>edit({...document,content})} onError={setError}/>}
    {publishOpen&&<Modal title="审核并发布个人方案" onClose={()=>!busy&&setPublishOpen(false)}><p>将发布 {document.content.entities.filter(e=>e.entity==='requirement').length} 个新需求。未明确纳入本期的需求保持候选，人员和未完成排期可之后填写。</p><p>发布不自动开工、验收或建立交付承诺。已发布草稿只读。</p>{error&&<p role="alert">{error}</p>}<button className="primary" disabled={!ready||busy||!!pending||!preview||preview.draftVersion!==saved.version} onClick={()=>void publish()}>确认发布此版本</button></Modal>}
    {closeOpen&&<Modal title="关闭个人草稿" onClose={()=>setCloseOpen(false)}><p>内容会保留并设为只读，不写入正式项目。</p><button disabled={busy} onClick={()=>void close()}>确认关闭</button></Modal>}
    {state.conflict&&<Modal title="合并网页与 Agent 的编辑" width={850} onClose={()=>{}} closable={false}><p>你的输入已保留。不同字段的修改自动合并；以下重叠修改请逐项选择。</p>{mergeDraftDocument(state.conflict.base,state.conflict.local,{title:state.conflict.remote.title,content:state.conflict.remote.content}).conflicts.map(c=><div className="draft-conflict" key={c.path}><strong>{c.path}</strong><label><input type="radio" name={c.path} checked={choices[c.path]==='local'} onChange={()=>setChoices({...choices,[c.path]:'local'})}/>保留网页输入<pre>{displayValue(c.local)}</pre></label><label><input type="radio" name={c.path} checked={choices[c.path]==='remote'} onChange={()=>setChoices({...choices,[c.path]:'remote'})}/>使用服务端内容<pre>{displayValue(c.remote)}</pre></label></div>)}{state.conflict.remote.status!=='draft'?<><p>服务端草稿已结束，网页输入保留在浏览器恢复记录中。</p><button onClick={()=>{const link=window.document.createElement('a');const url=URL.createObjectURL(new Blob([JSON.stringify(state.conflict!.local,null,2)],{type:'application/json'}));link.href=url;link.download='未发布编辑-'+saved.id+'.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);state.accept(state.conflict!.remote);}}>下载保留的修改并查看已结束版本</button></>:<button disabled={mergeDraftDocument(state.conflict.base,state.conflict.local,{title:state.conflict.remote.title,content:state.conflict.remote.content}).conflicts.some(c=>!choices[c.path])} onClick={()=>{state.resolve(choices);setChoices({});}}>应用选项并继续编辑</button>}</Modal>}
  </section>;
}
function displayValue(v:unknown):string{if(v===undefined)return '已删除';if(v===null)return '未填写';if(typeof v==='object')return Object.entries(v).map(([k,value])=>k+'：'+displayValue(value)).join('\n');return String(v);}
