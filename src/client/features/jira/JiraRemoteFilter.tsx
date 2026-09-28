import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JiraUser } from '../../../shared/jira';
import { JiraMultiSelect } from './JiraMultiSelect';
import * as jira from './api';

export function JiraRemoteFilter({ kind, projectId, version, scope, value, onChange, disabled }: {
  kind: 'users' | 'labels'; projectId: string; version: string; scope: (string | null | undefined)[]; value: string[];
  onChange: (value: string[]) => void; disabled: boolean;
}) {
  const [query, setQuery] = useState('');
  const result = useQuery({ queryKey: [...scope, kind, query], queryFn: async () => kind === 'users'
    ? (await jira.metadata<JiraUser[]>(projectId, { kind, version, query })).map(u => ({ value: u.name, label: `${u.displayName} (${u.name})` }))
    : (await jira.metadata<string[]>(projectId, { kind, version, query })).map(v => ({ value: v, label: v })),
  enabled: !disabled && !!query, retry: false, refetchOnWindowFocus: false, gcTime: 0 });
  return <JiraMultiSelect label={kind === 'users' ? '负责人' : '标签'} value={value} options={result.data || []} onChange={onChange} disabled={disabled} onSearch={setQuery} loading={result.isFetching} error={result.error?.message} onRetry={() => void result.refetch()} allowCreate={kind === 'labels'} unavailable={false} emptyText={query ? '没有匹配的选项' : '输入名称搜索'} />;
}
