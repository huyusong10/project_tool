import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProjects } from '../app-context';
import { keys } from '../query-keys';
import { templatesQuery } from '../features/templates/api';
import type { WorkItemTemplate } from '../types';
import { Button } from './Button';
import { Modal } from './Modal';
import { Select } from './Select';
import { TemplatePreview } from './TemplatePreview';

export function TemplateReuseDialog({ onClose, onSelect }: {
  onClose: () => void;
  onSelect: (template: WorkItemTemplate) => Promise<void>;
}) {
  const { projects, selectedProjectId } = useProjects();
  const [sourceProjectId, setSourceProjectId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false), [draftError, setDraftError] = useState('');
  const preparing = useRef(false);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: [...keys.templates, sourceProjectId],
    queryFn: ({ signal }) => templatesQuery(sourceProjectId, { signal, readOnly: true }),
    enabled: Boolean(sourceProjectId),
    retry: false,
  });
  const selected = data?.find(template => template.id === templateId);
  const prepare = async () => {
    if (!selected || preparing.current) return;
    preparing.current = true; setBusy(true); setDraftError('');
    try { await onSelect(selected); }
    catch (caught) { setDraftError('无法保存复用草稿：' + (caught as Error).message); }
    finally { preparing.current = false; setBusy(false); }
  };
  return <Modal title="复用已有流程" width={960} closable={!busy} onClose={onClose}>
    <div className="form-grid">
      <p className="field-help field-full">将流程复制到“{projects.find(project => project.id === selectedProjectId)?.name}”，调整并保存后可用于新需求。</p>
      <label className="field"><span>来源项目</span><Select aria-label="来源项目" disabled={busy} value={sourceProjectId} onChange={event => { setSourceProjectId(event.target.value); setTemplateId(''); setDraftError(''); }}>
        <option value="">请选择来源项目</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </Select></label>
      <label className="field"><span>来源流程</span><Select aria-label="来源流程" value={templateId} disabled={busy || !sourceProjectId || isFetching || Boolean(error)} onChange={event => { setTemplateId(event.target.value); setDraftError(''); }}>
        <option value="">{isFetching ? '正在读取流程…' : '请选择来源流程'}</option>
        {data?.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}
      </Select></label>
      {error && <div role="alert" className="field-full">{error.message}<Button variant="secondary" disabled={isFetching} onClick={() => void refetch()}>重新读取流程</Button></div>}
      {sourceProjectId && data?.length === 0 && !isFetching && !error && <p className="field-help field-full">来源项目暂无可用流程。</p>}
      {selected && !error && <div className="field-full"><TemplatePreview key={selected.id} template={selected} /></div>}
      {draftError && <p role="alert" className="form-error field-full">{draftError}</p>}
      <div className="form-actions field-full">
        <Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
        <Button variant="primary" busy={busy} disabled={busy || !selected || isFetching || Boolean(error)} onClick={() => void prepare()}>继续编辑</Button>
      </div>
    </div>
  </Modal>;
}
