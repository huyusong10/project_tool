import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Search, ShieldCheck, UserCog } from 'lucide-react';
import { api, jsonBody } from '../api';
import { useApp } from '../app-context';
import type { Account } from '../types';
import { EmptyState } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { AnchoredPopover, InlineSelectCell, InlineTextCell } from '../components/InlineEdit';
import { accountRoleLabels, accountRoleOptions, accountStatusOptions } from '../ui-options';

function AccountPermissionEditor({ account, projects, display, onSave }: {
  account: Account;
  projects: Array<{ id: string; name: string }>;
  display: 'role' | 'projects';
  onSave: (input: { role: Account['role']; managedProjectIds: string[] }) => Promise<unknown>;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState(account.role);
  const [managed, setManaged] = useState(account.managedProjects.map((project) => project.id));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setRole(account.role);
    setManaged(account.managedProjects.map((project) => project.id));
    setError('');
  }, [account.managedProjects, account.role, open]);
  const submit = async () => {
    if (role === 'project_manager' && !managed.length) return;
    setPending(true); setError('');
    try {
      await onSave({ role, managedProjectIds: role === 'project_manager' ? managed : [] });
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请重试');
    } finally { setPending(false); }
  };
  const projectText = account.role === 'admin' ? '全部项目' : account.managedProjects.map((project) => project.name).join('、') || '—';
  if (account.isBuiltin) return display === 'role'
    ? <span className={`account-role role-${account.role}`}><UserCog size={14} />{accountRoleLabels[account.role]}</span>
    : <span className="managed-projects">{projectText}</span>;
  return <div className="inline-edit-cell account-permission-editor" ref={anchorRef} onClick={(event) => event.stopPropagation()}>
    <button type="button" className="inline-edit-trigger" aria-expanded={open} onClick={() => setOpen(true)}>
      <span className="inline-edit-value inline-edit-value-single">{display === 'role' ? <span className={`account-role role-${account.role}`}><UserCog size={14} />{accountRoleLabels[account.role]}</span> : <span className="managed-projects">{projectText}</span>}</span>
    </button>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={() => setOpen(false)} width={390}>
      <div className="inline-action-form account-permission-popover">
        <header><strong>配置账号权限</strong></header>
        <label><span>权限角色</span><select autoFocus value={role} onChange={(event) => setRole(event.target.value as Account['role'])}>{accountRoleOptions.map((option) => <option key={option.value} value={option.value} disabled={option.value === 'project_manager' && !account.personId}>{option.label}</option>)}</select></label>
        {role === 'project_manager' && <fieldset><legend>负责项目</legend><div className="account-inline-projects">{projects.map((project) => <label key={project.id}><input type="checkbox" checked={managed.includes(project.id)} onChange={(event) => setManaged((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} /><span>{project.name}</span></label>)}</div>{!managed.length && <small className="danger-text">项目经理至少需要负责一个项目</small>}</fieldset>}
        <p className="inline-action-hint">普通用户维护自己的工作项；项目经理管理所选项目；管理员拥有全局权限。</p>
        {error && <p className="form-error">{error}</p>}
        <footer><button type="button" className="ghost-button" onClick={() => setOpen(false)}>取消</button><button type="button" className="primary-button" disabled={pending || role === 'project_manager' && !managed.length} onClick={() => void submit()}>保存权限</button></footer>
      </div>
    </AnchoredPopover>
  </div>;
}

export function AccountsPage() {
  const client = useQueryClient(); const [keyword, setKeyword] = useState('');
  const { projects } = useApp();
  const { data = [], isLoading } = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/api/accounts') });
  const accounts = useMemo(() => data.filter((account) => !keyword || `${account.username}${account.personName || ''}${account.jobTitle || ''}`.toLowerCase().includes(keyword.toLowerCase())), [data, keyword]);
  const reset = useMutation({
    mutationFn: (id: string) => api<{ temporaryPassword: string }>(`/api/accounts/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (result) => { void client.invalidateQueries({ queryKey: ['accounts'] }); alert(`密码已重置为 ${result.temporaryPassword}，该用户下次登录必须修改密码。`); },
  });
  const saveAccount = async (account: Account, input: Record<string, unknown>) => {
    const previous = client.getQueryData<Account[]>(['accounts']);
    client.setQueryData<Account[]>(['accounts'], (current = []) => current.map((entry) => {
      if (entry.id !== account.id) return entry;
      const role = typeof input.role === 'string' ? input.role as Account['role'] : entry.role;
      const managedIds = Array.isArray(input.managedProjectIds) ? input.managedProjectIds.map(String) : entry.managedProjects.map((project) => project.id);
      return {
        ...entry,
        ...(typeof input.username === 'string' ? { username: input.username } : {}),
        ...(input.status === 'active' || input.status === 'disabled' ? { status: input.status } : {}),
        role,
        managedProjects: role === 'project_manager' ? projects.filter((project) => managedIds.includes(project.id)).map(({ id, name }) => ({ id, name })) : [],
      };
    }));
    try {
      const saved = await api<Account>(`/api/accounts/${account.id}`, { method: 'PATCH', body: jsonBody(input) });
      client.setQueryData<Account[]>(['accounts'], (current = []) => current.map((entry) => entry.id === saved.id ? saved : entry));
      void client.invalidateQueries({ queryKey: ['session'] });
      void client.invalidateQueries({ queryKey: ['people'] });
    } catch (error) {
      client.setQueryData(['accounts'], previous);
      throw error;
    }
  };
  return <>
    <PageHeader title="账号管理" />
    <div className="page-content accounts-page">
      <div className="account-guide"><ShieldCheck size={19} /><div><strong>账号随人员自动创建</strong><span>新账号初始密码为 888888，首次登录必须修改。</span></div></div>
      <div className="filter-bar"><label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索登录名、人员或岗位" /></label><span>{accounts.length} 个账号</span></div>
      <section className="table-panel account-table-panel"><table><thead><tr><th>人员 / 登录名</th><th>角色</th><th>负责项目</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}>
        <td>{account.isBuiltin ? <><strong>{account.personName || '内置管理员'}</strong><small>{account.username} · {account.jobTitle || '—'}</small></> : <InlineTextCell value={account.username} label="登录名" required displayMode="stacked" onSave={(username) => saveAccount(account, { username })} renderValue={(username) => <><strong>{account.personName || '未关联人员'}</strong><small>{username} · {account.jobTitle || '—'}</small></>} />}</td>
        <td><AccountPermissionEditor account={account} projects={projects} display="role" onSave={(input) => saveAccount(account, input)} /></td>
        <td><AccountPermissionEditor account={account} projects={projects} display="projects" onSave={(input) => saveAccount(account, input)} /></td>
        <td><div className="account-state-cell">{account.isBuiltin ? <span className={`account-status ${account.status}`}>启用</span> : <InlineSelectCell value={account.status} label="账号状态" options={accountStatusOptions} displayMode="badge" onSave={(status) => saveAccount(account, { status })} renderValue={(value, option) => <span className={`account-status ${value}`}>{option?.label || value}</span>} />}{account.mustChangePassword && <span className="account-password-state">待修改初始密码</span>}</div></td>
        <td>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</td>
        <td><div className="project-row-actions"><button className="inline-action-button" onClick={() => confirm(`将“${account.username}”的密码重置为888888？`) && reset.mutate(account.id)}><KeyRound size={14} />重置密码</button></div></td>
      </tr>)}</tbody></table>{!accounts.length && !isLoading && <EmptyState title="没有符合条件的账号" detail="新增人员后会自动创建对应账号。" />}</section>
    </div>
  </>;
}
