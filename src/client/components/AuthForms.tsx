import { Button } from './Button';
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LockKeyhole, LogIn } from "lucide-react";
import { api, isWriteOutcomeUnknown, jsonBody } from "../api";
import { invalidate, keys } from "../query-keys";
import type { Session, SystemBranding } from "../types";
import { commitSession } from "../session-cache";
import { BrandLogo } from "./BrandLogo";
import { Modal, useSynchronousPendingLock } from "./Modal";

export function LoginDialog({ onClose, branding }: { onClose: () => void; branding: SystemBranding }) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const completeLogin = async (session: Session) => {
    await commitSession(client, session);
    invalidate(client, keys.session);
    onClose();
  };
  const login = useMutation({
    mutationFn: (value: object) =>
      api<Session>("/api/login", { method: "POST", body: jsonBody(value) }),
    onSuccess: completeLogin,
    onError: async (failure) => {
      if (isWriteOutcomeUnknown(failure)) {
        try {
          const latest = await api<Session>("/api/session", { readOnly: true });
          if (latest.authenticated) {
            await completeLogin(latest);
            return;
          }
        } catch {
          // 保留原登录异常；会话读取失败或仍为访客时不能确认登录成功。
        }
      }
      setError(failure.message);
    },
  });
  const lock = useSynchronousPendingLock(login.isPending);
  const close = () => {
    if (lock.canClose()) onClose();
  };
  return (
    <Modal title="用户登录" onClose={close} width={440} closable={!lock.busy}>
    <form
      className="form-grid login-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        lock.run(() => login.mutate(Object.fromEntries(new FormData(event.currentTarget))));
      }}
    >
      <BrandLogo branding={branding} className="login-brand-logo" />
      <p className="field-help field-full">
        登录后按账号角色进入个人工作台或项目管理功能。
      </p>
      <label className="field field-full">
        <span>用户名</span>
        <input
          name="username"
          defaultValue="admin"
          required
          autoFocus
          disabled={lock.busy}
          autoComplete="username"
        />
      </label>
      <label className="field field-full">
        <span>密码</span>
        <input
          name="password"
          type="password"
          required
          disabled={lock.busy}
          autoComplete="current-password"
        />
      </label>
      {error && <p className="form-error field-full">{error}</p>}
      <div className="form-actions field-full">
        <Button variant="secondary" type="button" className="ghost-button" disabled={lock.busy} onClick={close}>取消</Button>
        <Button busy={(lock.busy)} aria-label={lock.busy ? "登录中…" : "用户登录"} variant="primary" type="submit" className="primary-button" disabled={lock.busy}>
          <LogIn size={16} />
          {"用户登录"}
        </Button>
      </div>
      <div className="http-form-warning field-full">
        <LockKeyhole size={14} />
        当前为HTTP局域网访问，请仅在可信网络中输入密码。
      </div>
    </form>
    </Modal>
  );
}

export function PasswordDialog({ forced, onClose }: { forced: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const verifyPasswordOutcome = async () => {
    setVerifying(true);
    try {
      const latest = await api<Session>("/api/session", { readOnly: true });
      if (!latest.authenticated || forced && !latest.mustChangePassword) {
        await commitSession(client, latest);
        invalidate(client, keys.session);
        onClose();
        return "completed" as const;
      }
      return forced ? "retry" as const : "unknown" as const;
    } catch {
      return "unknown" as const;
    } finally {
      setVerifying(false);
    }
  };
  const mutation = useMutation({
    mutationFn: (value: object) => api<{ session: Session }>("/api/account/change-password", { method: "POST", body: jsonBody(value) }),
    onSuccess: async ({ session }) => { await commitSession(client, session); invalidate(client, keys.session); onClose(); },
    onError: async (failure) => {
      if (isWriteOutcomeUnknown(failure)) {
        setOutcomeUnknown(true);
        const result = await verifyPasswordOutcome();
        if (result === "completed") return;
        if (result === "retry") {
          setOutcomeUnknown(false);
          mutation.reset();
          setError("服务端仍要求修改初始密码，请重新提交。");
          return;
        }
        setError(forced
          ? "修改结果暂时无法确认，请重新读取会话状态，避免重复提交。"
          : "修改结果暂时无法确认。请关闭窗口，退出后使用新密码重新登录；不要重复提交。");
        return;
      }
      setError(failure.message);
    },
  });
  const lock = useSynchronousPendingLock(mutation.isPending);
  const close = () => {
    if (!forced && !verifying && lock.canClose()) onClose();
  };
  return <Modal title={forced ? "修改初始密码" : "修改密码"} onClose={close} width={460} closable={!forced && !lock.busy && !verifying}><form className="form-grid" onSubmit={(event) => {
    event.preventDefault(); if (outcomeUnknown || verifying) return; setError(""); const values = Object.fromEntries(new FormData(event.currentTarget));
    if (values.newPassword !== values.confirmPassword) return setError("两次输入的新密码不一致");
    lock.run(() => mutation.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword }));
  }}>
    {forced && <div className="password-required field-full"><KeyRound size={19} /><div><strong>首次登录需要修改密码</strong><span>修改后才能使用工作台和业务功能。</span></div></div>}
    <label className="field field-full"><span>当前密码</span><input name="currentPassword" type="password" required autoFocus disabled={lock.busy || outcomeUnknown || verifying} autoComplete="current-password" /></label>
    <label className="field field-full"><span>新密码</span><input name="newPassword" type="password" minLength={8} required disabled={lock.busy || outcomeUnknown || verifying} autoComplete="new-password" placeholder="至少8个字符" /></label>
    <label className="field field-full"><span>确认新密码</span><input name="confirmPassword" type="password" minLength={8} required disabled={lock.busy || outcomeUnknown || verifying} autoComplete="new-password" /></label>
    {error && <p className="form-error field-full">{error}</p>}
    <div className="form-actions field-full">{!forced && <Button variant="secondary" type="button" className="ghost-button" disabled={lock.busy || verifying} onClick={close}>取消</Button>}{forced && outcomeUnknown && <Button busy={(verifying)} aria-label={verifying ? "读取中…" : "重新读取会话状态"} variant="secondary" type="button" className="ghost-button" disabled={verifying} onClick={() => void verifyPasswordOutcome().then((result) => {
      if (result === "retry") { setOutcomeUnknown(false); mutation.reset(); setError("服务端仍要求修改初始密码，请重新提交。"); }
      else if (result === "unknown") setError("修改结果仍无法确认，请稍后重新读取会话状态。");
    })}>{"重新读取会话状态"}</Button>}<Button busy={(verifying) || (lock.busy)} aria-label={verifying ? "核对中…" : lock.busy ? "保存中…" : "保存新密码"} variant="primary" type="submit" className="primary-button" disabled={lock.busy || outcomeUnknown || verifying}>{"保存新密码"}</Button></div>
  </form></Modal>;
}
