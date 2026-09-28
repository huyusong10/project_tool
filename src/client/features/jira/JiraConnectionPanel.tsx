import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, Pencil, PlugZap, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useSession } from '../../app-context';
import { Button } from '../../components/Button';
import { ConfirmDialog, useSynchronousPendingLock } from '../../components/Modal';
import { FormError, FormField } from '../../components/Form';
import { LoadingState } from '../../components/Feedback';
import { ApiError } from '../../api';
import { jiraSetupMessages } from '../../../shared/jira';
import { connectionFeedback } from './connection-feedback';
import * as jira from './api';
import './jira.css';

export function JiraConnectionPanel() {
  const { session } = useSession(), client = useQueryClient();
  const [token, setToken] = useState(''), [editing, setEditing] = useState(false), [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState('');
  const key = ['jira-connection', session.accountId];
  const query = useQuery({ queryKey: key, queryFn: jira.connection, retry: false });
  const action = useMutation({
    mutationFn: async (kind: 'save' | 'test' | 'remove') => {
      if (kind !== 'save') return kind === 'test' ? jira.testConnection() : jira.removeConnection();
      const current = await jira.connection();
      client.setQueryData(key, current);
      if (current.setupIssue) throw new ApiError(jiraSetupMessages[current.setupIssue], 409, current.setupIssue === 'disabled' ? 'JIRA_DISABLED' : 'JIRA_KEY_UNAVAILABLE');
      return jira.saveConnection(token.trim());
    },
    onMutate: async () => { setMessage(''); await client.cancelQueries({ queryKey: key }); },
    onSuccess: (data, kind) => {
      client.setQueryData(key, data);
      if (kind !== 'test') {
        client.removeQueries({ queryKey: ['jira-scan'] });
        client.removeQueries({ queryKey: ['jira-sync'] });
        client.removeQueries({ queryKey: ['jira-progress', session.accountId] });
        client.removeQueries({ queryKey: ['jira-requirement', session.accountId] });
        client.removeQueries({ queryKey: ['jira-action-options', session.accountId] });
        client.removeQueries({ queryKey: ['jira-metadata', session.accountId] });
      }
      setToken(''); setEditing(false); setRemoving(false);
      setMessage(kind === 'save' ? '连接验证成功，Token 已保存。' : kind === 'test' ? '已保存的连接验证成功。' : '本系统保存的 Jira Token 已移除。');
    },
    onError: () => { void client.invalidateQueries({ queryKey: key }); },
  });
  const lock = useSynchronousPendingLock(action.isPending);
  const status = query.data, showForm = !!status && !status.setupIssue && !query.error && (!status.configured || editing);
  const verified = !!status?.verifiedAt && status.available;
  const statusLabel = !status ? query.error ? '读取失败' : '读取中' : status.setupIssue === 'disabled' ? '已停用' : status.problem ? '连接不可用' : verified ? '已验证' : status.configured ? '待验证' : '未配置';
  const feedback = connectionFeedback(action.error, action.variables) || connectionFeedback(query.error);
  function edit() { action.reset(); setMessage(''); setEditing(true); }
  return <section className="panel jira-connection-panel">
    <header className="jira-section-header"><h2><PlugZap size={18} /> Jira 连接</h2><span className={verified ? 'jira-connection-status is-verified' : 'jira-connection-status'}>{verified && <CheckCircle2 size={14} />}{statusLabel}</span></header>
    <div className="jira-connection-body">
      {query.isLoading && <LoadingState label="正在读取 Jira 连接" />}
      {status && <dl className="jira-connection-facts">
        <div><dt>Jira 地址</dt><dd>{status.baseUrl}</dd></div>
        <div><dt>Jira 账号</dt><dd>{status.identity || '未验证'}</dd></div>
        <div><dt>最近验证</dt><dd>{status.verifiedAt ? new Date(status.verifiedAt).toLocaleString('zh-CN', { hour12: false }) : '未验证'}</dd></div>
      </dl>}
      {status?.setupIssue && <div className="jira-setup-notice" role="status">{jiraSetupMessages[status.setupIssue]}</div>}
      <FormError>{status?.setupIssue ? feedback === jiraSetupMessages[status.setupIssue] ? null : feedback : feedback || status?.problem}</FormError>
      {(query.error || status?.setupIssue || action.error) && <div className="jira-connection-actions"><Button variant="secondary" disabled={query.isFetching || lock.busy} onClick={() => { action.reset(); void query.refetch(); }}><RefreshCw size={15} />重新读取连接</Button></div>}
      {message && <p className="jira-connection-message" role="status">{message}</p>}
      {status?.configured && (!editing || !!status.setupIssue) && <div className="jira-saved-credential">
        <div><KeyRound size={17} /><span>个人访问 Token 已保存</span></div>
        <div className="jira-connection-actions">
          <Button variant="secondary" busy={action.isPending && action.variables === 'test'} disabled={lock.busy || status.setupIssue === 'deployment' || status.setupIssue === 'disabled'} onClick={() => lock.run(() => action.mutate('test'))}><RefreshCw size={15} />测试连接</Button>
          <Button variant="secondary" disabled={lock.busy || !!status.setupIssue || !!query.error} onClick={edit}><Pencil size={15} />替换 Token</Button>
          <Button variant="secondary" aria-label="移除个人 Jira Token" title="移除个人 Jira Token" disabled={lock.busy} onClick={() => { action.reset(); setRemoving(true); }}><Trash2 size={15} /></Button>
        </div>
      </div>}
      {showForm && <form className="jira-credential-form" onSubmit={e => { e.preventDefault(); if (token.trim() && !status.setupIssue) lock.run(() => action.mutate('save')); }}>
        <FormField label={status.configured ? '新的 Jira 个人访问 Token' : 'Jira 个人访问 Token'} full>
          <input aria-label="Jira 个人访问 Token" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} maxLength={4096} onChange={e => { setToken(e.target.value); action.reset(); setMessage(''); }} disabled={lock.busy} required />
        </FormField>
        <div className="jira-connection-actions">
          <Button variant="primary" type="submit" busy={action.isPending} disabled={!token.trim() || lock.busy}><Save size={15} />验证并保存</Button>
          {status.configured && <Button variant="secondary" type="button" disabled={lock.busy} onClick={() => { setToken(''); setEditing(false); action.reset(); }}>取消替换</Button>}
        </div>
      </form>}
    </div>
    {removing && <ConfirmDialog title="移除 Jira 连接" description="删除本系统保存的个人 Jira Token。已有需求绑定保留，Jira 中的 Token 不会被撤销。" confirmLabel="移除" danger pending={lock.busy} error={connectionFeedback(action.error, 'remove') || undefined} onClose={() => setRemoving(false)} onConfirm={() => lock.run(() => action.mutate('remove'))} />}
  </section>;
}
