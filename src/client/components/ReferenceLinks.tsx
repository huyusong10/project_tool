import {FileText, ExternalLink, Link2, Ticket, GripVertical, X, Plus} from 'lucide-react';
import {inferReferenceLink, linkKindLabels, readReferenceLinks, type ReferenceLink, type LinkKind} from '../../shared/reference-links';
import {Button} from './Button';
import {Select} from './Select';
import {SortableList} from './SortableList';
import {useDetailSection} from './DetailWorkspace';
import './reference-links.css';

const icons = {document:FileText, task:Ticket, other:Link2};

export function ReferenceLinks({links, legacy, compact=false}: {links?:ReferenceLink[];legacy?:string|null;compact?:boolean}) {
  const values=readReferenceLinks(links,legacy), section=useDetailSection();
  if(!values.length)return null;
  return <div className={'reference-links'+(compact?' is-compact':'')} aria-label="关联链接">
    {(compact?values.slice(0,3):values).map(link=>{const kind=link.kind||'other',Icon=icons[kind]||ExternalLink;return <a key={link.url} href={/^https?:\/\//i.test(link.url)?link.url:undefined} target="_blank" rel="noreferrer" title={link.url}>
      <Icon size={15}/><span>{link.title}</span><small>{linkKindLabels[kind]||'其他'}</small><ExternalLink size={12}/>
    </a>;})}
    {compact&&values.length>3&&section&&<Button variant="link" size="compact" onClick={()=>section('basic')}>全部 {values.length} 项</Button>}
  </div>;
}

/** Controlled fields: the owning object form keeps the draft and submits once. */
export function ReferenceLinksEditor({value,onChange,disabled=false}: {value:ReferenceLink[];onChange:(value:ReferenceLink[])=>void;disabled?:boolean}) {
  const change=(index:number,patch:Partial<ReferenceLink>)=>onChange(value.map((link,i)=>i===index?{...link,...patch}:link));
  return <section className="reference-links-editor field-full" aria-label="编辑关联链接">
    <header><div><strong>关联链接</strong><small>名称自由填写，可关联文档、任务或其他资料。</small></div><Button type="button" variant="secondary" size="compact" disabled={disabled||value.length>=20} onClick={()=>onChange([...value,{title:'',url:'',kind:'other'}])}><Plus size={14}/>添加</Button></header>
    <SortableList items={value} getId={(_,i)=>'link-'+i} disabled={disabled} onReorder={onChange} getPreview={link=>({title:link.title||'关联链接',detail:link.url})} renderItem={(link,index,state)=><div ref={state.setNodeRef} className={'reference-link-row field'+(state.isDragging?' is-dragging':'')+(state.isOver?' is-over':'')}>
      <Button type="button" variant="ghost" iconOnly size="compact" disabled={disabled} {...state.handleAttributes} {...state.handleListeners} aria-label={'拖动链接 '+(index+1)+' 调整顺序'} title="拖动排序；也可按空格及方向键"><GripVertical size={15}/></Button>
      <Select aria-label={'链接 '+(index+1)+' 类型'} value={link.kind||inferReferenceLink(link.url).kind} disabled={disabled} onChange={e=>change(index,{kind:e.target.value as LinkKind})}>{Object.entries(linkKindLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select>
      <input className="reference-link-name" aria-label={'链接 '+(index+1)+' 名称'} placeholder="名称，如 MDS、Jira Task" maxLength={200} required value={link.title} disabled={disabled} onChange={e=>change(index,{title:e.target.value})}/>
      <input aria-label={'链接 '+(index+1)+' 地址'} placeholder="https://…" type="url" pattern="[hH][tT][tT][pP][sS]?://.*" maxLength={4000} required value={link.url} disabled={disabled} onChange={e=>{const next=inferReferenceLink(e.target.value),previous=inferReferenceLink(link.url);change(index,{url:e.target.value,...(!link.title||link.title===previous.title?{title:next.title}:{}),...(!link.url||link.kind===previous.kind?{kind:next.kind}:{})});}}/>
      <Button type="button" variant="ghost" iconOnly size="compact" disabled={disabled} aria-label={'移除链接 '+(index+1)} onClick={()=>onChange(value.filter((_,i)=>i!==index))}><X size={14}/></Button>
    </div>}/>
  </section>;
}
