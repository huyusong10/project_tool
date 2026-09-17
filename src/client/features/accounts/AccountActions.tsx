

import { Button } from "../../components/Button";

import { useRef, useState } from 'react';

import { Archive, KeyRound, MoreHorizontal, Trash2, UserRoundCheck, UserRoundX } from 'lucide-react';

import type { Account, Person } from "../../types";

import { AnchoredPopover } from '../../components/inline-edit/popover';

export function AccountActions({ account, person, currentAccountId, pending, onReset, onToggleLogin, onDelete, onOpen, onArchive }: {
  account: Account | null;
  person: Person | null;
  currentAccountId?: string;
  pending: boolean;
  onReset?: () => void;
  onToggleLogin?: () => void;
  onDelete?: () => void;
  onOpen?: () => void;
  onArchive?: () => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const name = account?.username || person?.name || '账号';
  return <div className="account-actions" ref={anchorRef}>
    <Button variant="ghost" iconOnly type="button" className="account-actions-trigger" aria-label={`打开${name}操作`} aria-expanded={open} disabled={pending} onClick={() => { if (!pending) setOpen((value) => !value); }}><MoreHorizontal size={17} /></Button>
    <AnchoredPopover anchorRef={anchorRef} open={open} onOutside={() => setOpen(false)} width={190} className="account-actions-popover">
      <div role="menu" aria-label={`${name}操作`}>
        {account && onReset && <Button variant="menu" type="button" role="menuitem" onClick={() => { setOpen(false); onReset(); }}><KeyRound size={14} />重置密码</Button>}
        {account && onToggleLogin && <Button variant="menu" type="button" role="menuitem" onClick={() => { setOpen(false); onToggleLogin(); }}>{account.status === 'active' ? <UserRoundX size={14} /> : <UserRoundCheck size={14} />}{account.status === 'active' ? '禁止登录' : '允许登录'}</Button>}
        {!account && onOpen && <Button variant="menu" type="button" role="menuitem" onClick={() => { setOpen(false); onOpen(); }}><UserRoundCheck size={14} />开通账号</Button>}
        {account && !account.isBuiltin && account.id !== currentAccountId && onDelete && <Button variant="menu" tone="danger" type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={14} />删除账号</Button>}
        {person && onArchive && <Button variant="menu" tone="danger" type="button" role="menuitem" className="danger" onClick={() => { setOpen(false); onArchive(); }}><Archive size={14} />归档人员</Button>}
      </div>
    </AnchoredPopover>
  </div>;
}
