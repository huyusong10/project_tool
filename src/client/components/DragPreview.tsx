import {useLayoutEffect,useRef,type DragEvent} from 'react';
import {useDndContext} from '@dnd-kit/core';
import './drag-preview.css';

export type DragPreviewData = {title: string; detail?: string; count?: number; kind?: string};

/** Reuse the visible object's name/header, including its icon, typography and colours. */
function sourcePreview(source: HTMLElement, data: DragPreviewData) {
  const original=source.querySelector<HTMLElement>('.work-item-name-editor .inline-edit-cell,.analytics-panel>header')
    || source.closest('tr')?.querySelector<HTMLElement>('.outline-name') || source;
  const copy=original.cloneNode(true) as HTMLElement;
  const originals=[original,...original.querySelectorAll<HTMLElement>('*')];
  const copies=[copy,...copy.querySelectorAll<HTMLElement>('*')];
  originals.forEach((element,index)=>{
    const target=copies[index],style=getComputedStyle(element);
    for(const key of style)target.style.setProperty(key,style.getPropertyValue(key));
    for(const attribute of [...target.attributes])if(attribute.name==='id'||attribute.name.startsWith('aria-')||attribute.name.startsWith('data-'))target.removeAttribute(attribute.name);
    target.removeAttribute('tabindex');target.style.transition='none';target.style.animation='none';
  });
  copy.querySelectorAll('.outline-expand,.workspace-enter,.analytics-panel-actions,.inline-edit-chevron').forEach(element=>element.remove());
  Object.assign(copy.style,{position:'static',transform:'none',opacity:'1',width:'100%',minWidth:'0',maxWidth:'100%',height:'auto',margin:'0',paddingInlineStart:'0',boxShadow:'none'});
  const body=document.createElement('div');body.className='drag-preview-object';body.append(copy);
  if((data.count||1)>1){const count=document.createElement('span');count.className='drag-preview-count';count.textContent=String(data.count)+' 项';body.append(count);}
  return body;
}

export function DragPreview({title,count,kind}: DragPreviewData) {
  const root=useRef<HTMLDivElement>(null),{activeNode}=useDndContext();
  useLayoutEffect(()=>{
    if(!root.current)return;
    if(activeNode)root.current.replaceChildren(sourcePreview(activeNode,{title,count}));
    else root.current.textContent=title;
  },[activeNode,title,count]);
  return <div ref={root} className="drag-preview" data-sortable-drag-preview data-kind={kind} aria-hidden="true" inert/>;
}

export function hasActiveSortDrag() {return typeof document !== 'undefined' && !!document.querySelector('[data-sortable-drag-preview]');}

export function setNativeDragPreview(event: DragEvent, data: DragPreviewData) {
  const preview=document.createElement('div');preview.className='drag-preview drag-preview-native';preview.dataset.kind=data.kind||'work';
  preview.setAttribute('aria-hidden','true');preview.inert=true;preview.append(sourcePreview(event.currentTarget as HTMLElement,data));
  document.body.append(preview);event.dataTransfer.setDragImage(preview,24,24);
  window.setTimeout(()=>preview.remove(),0);
}
