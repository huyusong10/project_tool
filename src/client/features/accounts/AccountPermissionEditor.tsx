

import { Button } from "../../components/Button";

import { useRef, useState } from 'react';

import { UserCog } from 'lucide-react';
import { requiresWriteRecheck } from "../../api";

import type { Account } from "../../types";

import { AnchoredPopover } from '../../components/inline-edit/popover';
import { EditableCell } from '../../components/inline-edit/shared';

import { accountRoleLabels, accountRoleOptions } from "../../ui-options";

export function AccountPermissionEditor({ account, disabled = false, onSave, onReload }: {
  account: Account;
  disabled?: boolean;
  onSave: (input: { role: Account['globalRole'] }, expectedUpdatedAt: string) => Promise<unknown>;
  onReload: () => Promise<Account>;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(account.globalRole);
  const [pending, setPending] = useState(false);
  const [reading, setReading] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [baselineUpdatedAt, setBaselineUpdatedAt] = useState(account.updatedAt);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const changed = account.updatedAt !== baselineUpdatedAt;
  const submit = async () => {
    if (submitting.current || reading || changed || needsRefresh) return;
    submitting.current = true;
    setPending(true); setError('');
    try {
      await onSave({ role }, baselineUpdatedAt);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
      if (requiresWriteRecheck(caught)) setNeedsRefresh(true);
    } finally { submitting.current = false; setPending(false); }
  };
  const reload = async () => {
    if (reading || submitting.current) return;
    setReading(true); setError('');
    try {
      const latest = await onReload();
      setBaselineUpdatedAt(latest.updatedAt);
      setRole(latest.globalRole);
      setNeedsRefresh(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '账号读取失败');
    } finally { setReading(false); }
  };
  const projectNames = account.managedProjects.map((project) => project.name);
  const fullProjectText = account.globalRole === 'admin' ? '管理全部平台功能'
    : projectNames.length ? `项目经理：${projectNames.join('、')}` : '项目角色在各项目内配置';
  const projectText = account.globalRole === 'admin' || projectNames.length <= 2
    ? fullProjectText
    : `项目经理：${projectNames.slice(0, 2).join('、')} 等 ${projectNames.length} 个项目`;
  const summary = <span className="account-permission-summary" title={fullProjectText}><span className={`account-role role-${account.globalRole}`}><UserCog size={14} />{accountRoleLabels[account.globalRole]}</span><span className="managed-projects">{projectText}</span></span>;
  if (account.isBuiltin) return summary;
  return <div className="inline-edit-anchor" ref={anchorRef}>
    <EditableCell label="平台权限" display={summary} fullText={`${accountRoleLabels[account.globalRole]}，${fullProjectText}`}
      open={open} disabled={disabled} state={pending || reading ? 'saving' : error ? 'error' : 'idle'} error={error}
      displayMode="stacked" className="account-permission-editor" onOpen={() => { setRole(account.globalRole); setBaselineUpdatedAt(account.updatedAt); setNeedsRefresh(false); setError(''); setOpen(true); }}>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={() => !submitting.current && !reading && setOpen(false)} width={390}>
      <div className="inline-action-form account-permission-popover">
        <header><strong>配置平台权限</strong></header>
        <label><span>平台角色</span><select autoFocus disabled={pending || reading || disabled} value={role} onChange={(event) => setRole(event.target.value as Account['globalRole'])}>{accountRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <p className="inline-action-hint">项目经理在对应项目的“项目设置”中配置；这里仅控制平台管理员权限。</p>
        {(changed || needsRefresh) && <div className="warning-banner">账号权限已更新，当前选择尚未提交。<Button busy={(reading)} aria-label={reading ? '读取中…' : '重新读取账号'} variant="secondary" type="button" className="ghost-button" disabled={reading || pending} onClick={() => void reload()}>{'重新读取账号'}</Button></div>}
        {error && <p className="form-error">{error}</p>}
        <footer><Button variant="secondary" type="button" className="ghost-button" disabled={pending || reading || disabled} onClick={() => setOpen(false)}>取消</Button><Button busy={(pending)} aria-label={pending ? '保存中…' : '保存权限'} variant="primary" type="button" className="primary-button" disabled={pending || reading || disabled || changed || needsRefresh} onClick={() => void submit()}>{'保存权限'}</Button></footer>
      </div>
    </AnchoredPopover>
    </EditableCell>
  </div>;
}
