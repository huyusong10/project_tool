
import * as peopleApi from "../people/api";

import { Button } from "../../components/Button";

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { jsonBody, requiresWriteRecheck } from "../../api";

import { invalidateAccountViews, keys } from "../../query-keys";

import type { Person } from "../../types";

import { Modal, useSynchronousPendingLock } from "../../components/Modal";

import { canonicalizeLabel } from "../../../shared/search";

import { FormError, FormField, FormSubmitActions } from "../../components/Form";
import { useToast } from "../../components/Toast";

import { type CreatePersonRecheck, type CreatePersonInput } from './model';

export function NewPersonForm({ recheck, onRecheckChange, onClose }: {
  recheck: CreatePersonRecheck | null;
  onRecheckChange: (value: CreatePersonRecheck | null) => void;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const mounted = useRef(true);
  const [recheckPending, setRecheckPending] = useState(false);
  const [recheckError, setRecheckError] = useState("");
  const needsRecheck = Boolean(recheck);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const initialPersonIds = useRef<Set<string> | null | undefined>(undefined);
  if (initialPersonIds.current === undefined) {
    if (recheck) {
      initialPersonIds.current = recheck.initialPersonIds ? new Set(recheck.initialPersonIds) : null;
    } else {
      const queryKey = [...keys.people, 'all'];
      const cached = client.getQueryData<Person[]>(queryKey);
      initialPersonIds.current = client.getQueryState(queryKey)?.status === 'success' && cached
        ? new Set(cached.map((person) => person.id))
        : null;
    }
  }
  const mutation = useMutation({
    mutationFn: (input: CreatePersonInput) => peopleApi.people<Person>({ method: 'POST', body: jsonBody(input) }),
    onMutate: (input) => {
      const sourceIds = initialPersonIds.current;
      onRecheckChange({ input, initialPersonIds: sourceIds ? [...sourceIds] : null });
      setRecheckError("");
    },
    onSuccess: () => {
      onRecheckChange(null);
      invalidateAccountViews(client);
      onClose();
    },
    onError: async (error, input) => {
      const sourceIds = initialPersonIds.current;
      if (!requiresWriteRecheck(error)) { onRecheckChange(null); return; }
      if (!sourceIds) return;
      try {
        const latest = await peopleApi.people<Person[]>({ readOnly: true });
        client.setQueryData([...keys.people, 'all'], latest);
        const matches = latest.filter((person) => !sourceIds.has(person.id)
          && person.name === canonicalizeLabel(input.name)
          && person.jobTitle === (canonicalizeLabel(input.jobTitle) || null)
          && Boolean(person.active));
        if (matches.length === 1) {
          onRecheckChange(null);
          invalidateAccountViews(client);
          if (mounted.current) {
            toast.success('已核对最新状态：人员和账号已创建');
            onClose();
          }
        } else if (matches.length === 0) {
          onRecheckChange(null);
          if (mounted.current) toast.info('已核对最新状态：未发现本次新增人员，可以重新提交');
        } else if (mounted.current) {
          setRecheckError('发现多个匹配人员，请重新读取后在列表核对。');
        }
      } catch {
        // 保留提交前人员基线、原草稿和跨导航锁。
      }
    },
  });
  const lock = useSynchronousPendingLock(mutation.isPending);
  const reloadPeople = async () => {
    const pendingRecheck = recheck;
    if (!pendingRecheck || recheckPending) return;
    const sourceIds = pendingRecheck.initialPersonIds ? new Set(pendingRecheck.initialPersonIds) : null;
    const input = pendingRecheck.input;
    setRecheckPending(true);
    setRecheckError("");
    try {
      const latest = await peopleApi.people<Person[]>({ readOnly: true });
      client.setQueryData([...keys.people, 'all'], latest);
      const matches = sourceIds ? latest.filter((person) => !sourceIds.has(person.id)
        && person.name === canonicalizeLabel(input.name)
        && person.jobTitle === (canonicalizeLabel(input.jobTitle) || null)
        && Boolean(person.active)) : [];
      if (matches.length === 1) {
        onRecheckChange(null);
        mutation.reset();
        invalidateAccountViews(client);
        toast.success('已核对最新状态：人员和账号已创建');
        onClose();
      } else if (sourceIds && matches.length === 0) {
        onRecheckChange(null);
        mutation.reset();
        toast.info('已核对最新状态：未发现本次新增人员，可以重新提交');
      } else {
        onRecheckChange(null);
        mutation.reset();
        invalidateAccountViews(client);
        toast.info(sourceIds ? '发现多个匹配人员，请在列表核对' : '已重新读取人员，请在列表核对创建结果');
        onClose();
      }
    } catch (caught) {
      setRecheckError(caught instanceof Error ? caught.message : "人员列表读取失败");
    } finally {
      setRecheckPending(false);
    }
  };
  const close = () => {
    if (lock.canClose() && !recheckPending) onClose();
  };
  const formBusy = lock.busy || needsRecheck || recheckPending;
  return <Modal title="新增人员" width={520} closable={!lock.busy && !recheckPending} onClose={close}><form className="form-grid" onSubmit={(event) => {
    event.preventDefault();
    if (needsRecheck || recheckPending) return;
    const data = new FormData(event.currentTarget);
    lock.run(() => mutation.mutate({ name: String(data.get('name') || ''), jobTitle: String(data.get('jobTitle') || '') }));
  }}>
    <FormField label="姓名" full><input name="name" required autoFocus disabled={formBusy} defaultValue={recheck?.input.name} /></FormField>
    <FormField label="岗位" full><input name="jobTitle" disabled={formBusy} defaultValue={recheck?.input.jobTitle} placeholder="例如：前端工程师、测试工程师" /></FormField>
    <p className="field-help field-full">保存后自动创建普通账号，初始密码为 888888。</p>
    <FormError>{lock.busy ? null : needsRecheck ? `新增人员结果待核对，当前草稿不会重复提交。${recheckError ? ` ${recheckError}` : ""}` : mutation.error?.message}</FormError>
    {needsRecheck && !lock.busy && <div className="field-full"><Button busy={(recheckPending)} aria-label={recheckPending ? "读取中…" : "重新读取人员"} variant="secondary" type="button" className="ghost-button" disabled={recheckPending} onClick={() => void reloadPeople()}>{"重新读取人员"}</Button></div>}
    <FormSubmitActions submitLabel="新增人员" pendingLabel={recheckPending ? "读取中…" : "保存中…"} cancelLabel={needsRecheck && !lock.busy ? "关闭并核对" : "取消"} onCancel={close} pending={lock.busy || recheckPending} disabled={needsRecheck} />
  </form></Modal>;
}
