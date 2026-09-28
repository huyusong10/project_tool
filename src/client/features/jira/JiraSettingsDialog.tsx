import { useState } from 'react';
import { jiraSettingsSchema, type JiraSettingsRecord, type JiraSettings } from '../../../shared/jira';
import { Button } from '../../components/Button';
import { Modal, useSynchronousPendingLock } from '../../components/Modal';
import { Select } from '../../components/Select';
import { FormError, FormField } from '../../components/Form';
import { JiraMultiSelect } from './JiraMultiSelect';
import { JiraRemoteFilter } from './JiraRemoteFilter';
import { useJiraMetadata } from './useJiraMetadata';
import { jiraFeedback } from './feedback';
import * as jira from './api';

export function JiraSettingsDialog({ projectId, current, onClose, onSaved }: { projectId: string; current: JiraSettingsRecord; onClose: () => void; onSaved: (saved: JiraSettingsRecord) => void }) {
  const [draft, setDraft] = useState(() => structuredClone(current.settings)), [typesEdited, setTypesEdited] = useState(false);
  const [mode, setMode] = useState(current.settings.jql ? 'jql' : 'fields'), [pending, setPending] = useState(false), [error, setError] = useState('');
  const metadata = useJiraMetadata(projectId, draft.projects), lock = useSynchronousPendingLock(pending);
  const defaults = !current.version && !typesEdited && mode === 'fields';
  const value = defaults ? { ...draft, issueTypes: [...new Set(metadata.typeRows.filter(t => /^(story|task|故事|任务)$/i.test(t.name)).map(t => t.id))] } : draft;
  const patch = (next: Partial<JiraSettings>) => setDraft(v => ({ ...v, ...next }));
  const options = (rows: Array<{ id: string; name: string }>, selected: string[]) => [...new Map(rows.map(r => [r.id, { value: selected.includes(r.name) ? r.name : r.id, label: r.name }])).values()];
  async function save() {
    if (value.enabled && (mode === 'jql' ? !value.jql.trim() : !value.projects.length)) { setError(mode === 'jql' ? '请填写 JQL' : '请选择 Jira 项目'); return; }
    if (value.enabled && defaults && (metadata.types.some(q => q.isFetching || q.error) || !value.issueTypes.length)) { setError('请读取并确认事项类型'); return; }
    setPending(true); setError('');
    try {
      const saved = await jira.saveSettings(projectId, jiraSettingsSchema.parse({ ...value, jql: mode === 'jql' ? value.jql.trim() : '' }), current.version);
      onSaved(saved); onClose();
    } catch (e) { setError(jiraFeedback(e)); } finally { setPending(false); }
  }
  return <Modal title="Jira 发现范围" width={800} layout="workspace" onClose={onClose} closable={!pending}>
    <form className="jira-settings-form" onSubmit={e => { e.preventDefault(); lock.run(() => void save()); }}>
      <fieldset disabled={pending} className="form-fieldset jira-settings-content">
        <label className="jira-check"><input type="checkbox" checked={value.enabled} onChange={e => patch({ enabled: e.target.checked })} />启用项目 Jira 集成</label>
        <div className="form-grid">
          <FormField label="Jira 项目" full><JiraMultiSelect label="Jira 项目" value={value.projects} options={(metadata.projects.data || []).map(p => ({ value: value.projects.includes(p.id) ? p.id : p.key, label: `${p.name} (${p.key})` }))} onChange={projects => patch({ projects })} disabled={!metadata.ready} loading={metadata.projects.isFetching} error={metadata.projects.error ? jiraFeedback(metadata.projects.error) : undefined} onRetry={() => void metadata.projects.refetch()} emptyText="当前账号没有可见项目" /></FormField>
          <FormField label="筛选方式" full><Select aria-label="筛选方式" value={mode} onChange={e => setMode(e.target.value)}><option value="fields">条件筛选</option><option value="jql">高级 JQL</option></Select></FormField>
          {mode === 'jql' ? <FormField label="JQL" full><textarea aria-label="JQL" rows={4} value={value.jql} onChange={e => patch({ jql: e.target.value })} /></FormField> : <>
            <FormField label="事项类型"><JiraMultiSelect label="事项类型" value={value.issueTypes} options={options(metadata.typeRows, value.issueTypes)} onChange={issueTypes => { setTypesEdited(true); patch({ issueTypes }); }} disabled={!metadata.ready} loading={metadata.types.some(q => q.isFetching)} error={metadata.types.some(q => q.error) ? '事项类型读取失败' : undefined} onRetry={() => metadata.types.filter(q => q.error).forEach(q => void q.refetch())} emptyText="请选择 Jira 项目" /></FormField>
            <FormField label="组件"><JiraMultiSelect label="组件" value={value.components} options={options(metadata.componentRows, value.components)} onChange={components => patch({ components })} disabled={!metadata.ready} loading={metadata.components.some(q => q.isFetching)} error={metadata.components.some(q => q.error) ? '组件读取失败' : undefined} onRetry={() => metadata.components.filter(q => q.error).forEach(q => void q.refetch())} emptyText="所选项目没有组件" /></FormField>
            <FormField label="负责人"><JiraRemoteFilter kind="users" projectId={projectId} version={metadata.version} scope={metadata.scope} value={value.assignees} onChange={assignees => patch({ assignees })} disabled={!metadata.ready} /></FormField>
            <FormField label="标签"><JiraRemoteFilter kind="labels" projectId={projectId} version={metadata.version} scope={metadata.scope} value={value.labels} onChange={labels => patch({ labels })} disabled={!metadata.ready} /></FormField>
          </>}
        </div>
      </fieldset>
      <footer className="jira-settings-footer"><div className="jira-settings-feedback"><FormError>{error}</FormError></div><div className="form-actions"><Button variant="secondary" type="button" disabled={pending} onClick={onClose}>取消</Button><Button variant="primary" type="submit" busy={pending} disabled={pending}>保存范围</Button></div></footer>
    </form>
  </Modal>;
}
