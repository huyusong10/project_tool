import type {DragEvent} from 'react';
import './drag-preview.css';

export type DragPreviewData = {title: string; detail?: string; count?: number; kind?: string};
const labels: Record<string, string> = {feature:'特性', phase:'Phase', requirement:'需求', work:'工作项', panel:'图表', milestone:'里程碑'};

export function DragPreview({title, detail, count = 1, kind = 'work'}: DragPreviewData) {
  return <div className="drag-preview" data-sortable-drag-preview data-kind={kind} aria-hidden="true">
    <span className="drag-preview-kind">{labels[kind] || '对象'}</span>
    <div><strong>{title}</strong>{detail && <small>{detail}</small>}</div>
    {count > 1 && <b className="drag-preview-count">{count}</b>}
  </div>;
}

export function hasActiveSortDrag() {return typeof document !== 'undefined' && !!document.querySelector('[data-sortable-drag-preview]');}

/** Native drags need a painted element before React commits their drag state. */
export function setNativeDragPreview(event: DragEvent, data: DragPreviewData) {
  const preview = document.createElement('div');
  preview.className = 'drag-preview drag-preview-native';
  preview.dataset.kind = data.kind || 'work';
  preview.setAttribute('aria-hidden', 'true');
  const kind = document.createElement('span'), text = document.createElement('div'), title = document.createElement('strong');
  kind.className = 'drag-preview-kind'; kind.textContent = labels[data.kind || 'work'] || '对象';
  title.textContent = data.title; text.append(title); preview.append(kind, text);
  if (data.detail) {const detail = document.createElement('small'); detail.textContent = data.detail; text.append(detail);}
  if ((data.count || 1) > 1) {const count = document.createElement('b'); count.className = 'drag-preview-count'; count.textContent = String(data.count); preview.append(count);}
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, 24, 24);
  window.setTimeout(() => preview.remove(), 0);
}
