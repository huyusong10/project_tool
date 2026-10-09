import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationMode, SystemBranding } from '../../../shared/api/system';
import { jsonBody, requiresWriteRecheck } from '../../api';
import { keys } from '../../query-keys';
import { Button } from '../../components/Button';
import { useSynchronousPendingLock } from '../../components/Modal';
import * as systemApi from './api';

export function ApplicationModeCard() {
  const client = useQueryClient();
  const [needsRecheck, setNeedsRecheck] = useState(false);
  const query = useQuery({ queryKey: keys.branding, queryFn: ({ signal }) => systemApi.branding({ signal }) });
  const mode = query.data?.applicationMode ?? { issueTrackingOnly: false, updatedAt: null };
  const save = useMutation({
    mutationFn: (input: { issueTrackingOnly: boolean; expectedUpdatedAt: string | null }) =>
      systemApi.applicationMode({ method: 'PUT', body: jsonBody(input) }),
    onSuccess: async (saved: ApplicationMode) => {
      await client.cancelQueries({ queryKey: keys.branding, exact: true });
      client.setQueryData<SystemBranding>(keys.branding, current => current ? { ...current, applicationMode: saved } : current);
      setNeedsRecheck(false);
    },
    onError: error => {
      if (requiresWriteRecheck(error)) setNeedsRecheck(true);
      void client.invalidateQueries({ queryKey: keys.branding });
    },
  });
  const lock = useSynchronousPendingLock(save.isPending);
  const reload = async () => {
    const latest = await query.refetch();
    if (!latest.error && latest.data) { setNeedsRecheck(false); save.reset(); }
  };
  return <article className="panel system-detail-panel system-mode-panel">
    <header><div><h2>功能设置</h2><p>统一控制所有用户可见的功能页面</p></div></header>
    <div className="system-mode-content">
      <label className="system-mode-switch"><input type="checkbox" role="switch" checked={save.isPending ? save.variables!.issueTrackingOnly : mode.issueTrackingOnly}
        disabled={!query.data || lock.busy || needsRecheck || query.isError}
        onChange={event => { const issueTrackingOnly = event.target.checked; lock.run(() => save.mutate({ issueTrackingOnly, expectedUpdatedAt: mode.updatedAt })); }} />仅启用问题跟踪功能</label>
      <p>开启后直接进入问题跟踪，保留项目切换、成员、账号和系统维护入口。关闭后恢复全部功能，历史数据和问题关联保持不变。</p>
      <p>此设置控制网页展示，REST 和 MCP 继续沿用原有权限。</p>
      {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
      {save.isSuccess && <p role="status">功能设置已保存。</p>}
      {(needsRecheck || query.error) && <div className="warning-banner">请重新读取功能设置，核对当前模式后再操作。<Button variant="secondary" disabled={lock.busy || query.isFetching} onClick={() => void reload()}>重新读取功能设置</Button></div>}
    </div>
  </article>;
}
