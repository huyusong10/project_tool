import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { JiraEntry } from '../../shared/jira-links';
import { Button } from './Button';
import { AnchoredPopover } from './inline-edit/popover';
import './jira-entries.css';

export function JiraEntries({ links, inherited = false }: { links?: JiraEntry[]; inherited?: boolean }) {
  const [open, setOpen] = useState(false), anchor = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => more.current?.querySelector('a')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const entries = (links || []).filter(entry => /^https?:\/\//i.test(entry.url));
  if (!entries.length) return null;
  const prefix = inherited ? '需求 JIRA' : 'JIRA';
  const link = (entry: JiraEntry) => <a key={entry.url} className="jira-entry-link" href={entry.url} target="_blank" rel="noopener noreferrer"
    aria-label={`${prefix} ${entry.key}${entry.source === 'reference' ? '（引用）' : ''}，在新标签页打开`}
    title={`${inherited ? '所属需求的 ' : ''}JIRA ${entry.key} · ${entry.source === 'binding' ? '主要关联' : '参考链接，未作为主要关联'} · 在新标签页打开`}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    <span>{prefix}</span><b>{entry.key}</b>{entry.source === 'reference' && <small>引用</small>}<ExternalLink size={12}/>
  </a>;
  return <span className="jira-entries nodrag nopan" data-workspace-zone="tools" data-preserve-edit onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {link(entries[0])}
    {entries.length > 1 && <><Button ref={anchor} variant="ghost" size="mini" aria-label={`查看其余 ${entries.length - 1} 个 JIRA 链接`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>+{entries.length - 1}</Button>
      <AnchoredPopover anchorRef={anchor} open={open} onOutside={() => setOpen(false)} onEscape={() => { setOpen(false); anchor.current?.focus(); }} preserveEditing width={300}>
        <div ref={more} className="jira-entry-more" aria-label="其他 JIRA 链接">{entries.slice(1).map(link)}</div>
      </AnchoredPopover></>}
  </span>;
}

export function WorkJiraEntries({ work, requirement }: { work?: { jiraLinks?: JiraEntry[] }; requirement?: { jiraLinks?: JiraEntry[] } }) {
  return <JiraEntries links={work?.jiraLinks?.length ? work.jiraLinks : requirement?.jiraLinks} inherited={!!work && !work.jiraLinks?.length}/>;
}
