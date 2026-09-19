

import { Button } from "../../components/Button";

import { useNavigate } from "react-router-dom";
import { KeyRound, LogIn } from "lucide-react";

import { useUiActions, useProjects } from "../../app-context";

export function GuestLanding() {
  const { openLogin } = useUiActions(), { projects, changeProject } = useProjects();
  return <div className="page-content guest-landing"><div className="panel"><KeyRound size={32}/>
    <h1>{projects.length ? '选择项目' : '暂未开放游客浏览'}</h1>
    <p>{projects.length ? '查看项目的交付安排、需求和工作进展。' : '登录有权限的账号后可查看项目。'}</p>
    {projects.length > 0 && <div className="guest-project-list">{projects.map(project => <Button key={project.id} variant="secondary" wrap onClick={() => changeProject(project.id)}>{project.name}</Button>)}</div>}
    <Button variant="primary" onClick={openLogin}><LogIn size={16}/>登录</Button>
  </div></div>;
}

export function StartupError({ title, error, pending, onRetry, back }: { title: string; error: Error; pending: boolean; onRetry: () => void; back?: { label: string; fallback: string } }) {
  const {openLogin} = useUiActions(),navigate=useNavigate();
  return <div className="page-content guest-landing"><div className="panel"><h1>{title}</h1><p>{error.message}</p><Button busy={(pending)} aria-label={pending ? "重新加载中…" : "重新加载"} variant="primary" className="primary-button" disabled={pending} onClick={onRetry}>{"重新加载"}</Button><Button variant="secondary" onClick={()=>navigate(back?.fallback || "/")}>{back?.label || '项目空间'}</Button><Button variant="secondary" onClick={openLogin}>切换账号</Button></div></div>;
}
