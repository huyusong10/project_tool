import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Search, ShieldCheck, UserCog } from 'lucide-react';
import { api, jsonBody } from '../api';
import { useApp } from '../app-context';
import type { Account } from '../types';
import { EmptyState, Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';

const roleLabels = { user: '普通用户', project_manager: '项目经理', admin: '管理员' } as const;

function AccountForm({ account, onClose }: { account: Account; onClose: () => void }) {
  const { projects } = useApp(); const client = useQueryClient();
  const [role, setRole] = useState(account.role);
  const [managed, setManaged] = useState(account.managedProjects.map((project) => project.id));
  const mutation = useMutation({
    mutationFn: (value: object) => api<Account>(`/api/accounts/${account.id}`, { method: 'PATCH', body: jsonBody(value) }),
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['accounts'] }); void client.invalidateQueries({ queryKey: ['session'] }); onClose(); },
  });
  return <form className="form-grid" onSubmit={(event) => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
    mutation.mutate({ username: values.username, status: values.status, role, managedProjectIds: role === 'project_manager' ? managed : [] });
  }}>
    <div className="account-person field-full"><span>{account.personName?.slice(-1) || 'A'}</span><div><strong>{account.personName || '系统内置账号'}</strong><small>{account.jobTitle || (account.isBuiltin ? '系统管理员' : '岗位未设置')}</small></div></div>
    <label className="field"><span>登录名</span><input name="username" defaultValue={account.username} required disabled={account.isBuiltin} /></label>
    <label className="field"><span>账号状态</span><select name="status" defaultValue={account.status} disabled={account.isBuiltin}><option value="active">启用</option><option value="disabled">停用</option></select></label>
    <label className="field field-full"><span>权限角色</span><select value={role} onChange={(event) => setRole(event.target.value as Account['role'])} disabled={account.isBuiltin}><option value="user">普通用户</option><option value="project_manager" disabled={!account.personId}>项目经理</option><option value="admin">管理员</option></select></label>
    {role === 'project_manager' && <fieldset className="project-permission-list field-full"><legend>负责项目</legend>{projects.map((project) => <label key={project.id}><input type="checkbox" checked={managed.includes(project.id)} onChange={(event) => setManaged((current) => event.target.checked ? [...current, project.id] : current.filter((id) => id !== project.id))} /><span>{project.name}</span></label>)}{!projects.length && <p>暂无可分配项目</p>}</fieldset>}
    <p className="field-help field-full">普通用户维护自己的工作项；项目经理管理所选项目；管理员拥有全局权限。</p>
    {mutation.error && <p className="form-error field-full">{mutation.error.message}</p>}
    <div className="form-actions field-full"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button" disabled={mutation.isPending || (role === 'project_manager' && !managed.length)}>保存账号</button></div>
  </form>;
}

export function AccountsPage() {
  const client = useQueryClient(); const [keyword, setKeyword] = useState(''); const [editing, setEditing] = useState<Account>();
  const { data = [], isLoading } = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/api/accounts') });
  const accounts = useMemo(() => data.filter((account) => !keyword || `${account.username}${account.personName || ''}${account.jobTitle || ''}`.toLowerCase().includes(keyword.toLowerCase())), [data, keyword]);
  const reset = useMutation({
    mutationFn: (id: string) => api<{ temporaryPassword: string }>(`/api/accounts/${id}/reset-password`, { method: 'POST' }),
    onSuccess: (result) => { void client.invalidateQueries({ queryKey: ['accounts'] }); alert(`密码已重置为 ${result.temporaryPassword}，该用户下次登录必须修改密码。`); },
  });
  return <>
    <PageHeader title="账号管理" />
    <div className="page-content accounts-page">
      <div className="account-guide"><ShieldCheck size={19} /><div><strong>账号随人员自动创建</strong><span>新账号初始密码为 888888，首次登录必须修改。</span></div></div>
      <div className="filter-bar"><label className="search-box"><Search size={16} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索登录名、人员或岗位" /></label><span>{accounts.length} 个账号</span></div>
      <section className="table-panel account-table-panel"><table><thead><tr><th>人员 / 登录名</th><th>角色</th><th>负责项目</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}>
        <td><strong>{account.personName || '内置管理员'}</strong><small>{account.username} · {account.jobTitle || '—'}</small></td>
        <td><span className={`account-role role-${account.role}`}><UserCog size={14} />{roleLabels[account.role]}</span></td>
        <td><span className="managed-projects">{account.role === 'admin' ? '全部项目' : account.managedProjects.map((project) => project.name).join('、') || '—'}</span></td>
        <td><span className={`account-status ${account.status}`}>{account.status === 'active' ? '启用' : '停用'}</span>{account.mustChangePassword && <small>待修改初始密码</small>}</td>
        <td>{account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</td>
        <td><div className="project-row-actions"><button className="inline-action-button" onClick={() => setEditing(account)}><Pencil size={14} />配置</button><button className="inline-action-button" onClick={() => confirm(`将“${account.username}”的密码重置为888888？`) && reset.mutate(account.id)}><KeyRound size={14} />重置密码</button></div></td>
      </tr>)}</tbody></table>{!accounts.length && !isLoading && <EmptyState title="没有符合条件的账号" detail="新增人员后会自动创建对应账号。" />}</section>
    </div>
    {editing && <Modal title="配置账号权限" width={620} onClose={() => setEditing(undefined)}><AccountForm account={editing} onClose={() => setEditing(undefined)} /></Modal>}
  </>;
}
