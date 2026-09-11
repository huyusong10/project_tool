import { dashboardScopeLabels, type DashboardScope } from '../shared/dashboard';
import { normalizeRequirementStatusFilter } from '../shared/requirement-view';
import { useViewPreference } from './use-view-preference';

export type RequirementSort = 'deadline' | 'risk' | 'progress' | 'updated';

export function useProjectGanttFilters(key: string) {
  const [search, setSearch] = useViewPreference<string>(key + ':search', '');
  const [savedStatus, setStatus] = useViewPreference<string>(key + ':status-v2', 'in_progress', { key: key + ':status', defaultValue: 'unfinished' });
  const [risk, setRisk] = useViewPreference<string>(key + ':risk', '');
  const [personId, setPersonId] = useViewPreference<string>(key + ':personId', '');
  const [group, setGroup] = useViewPreference<string>(key + ':group', '');
  const [schedule, setSchedule] = useViewPreference<string>(key + ':schedule', '');
  const [savedSort, setSort] = useViewPreference<string>(key + ':sort', 'risk');
  const [savedScope, setScope] = useViewPreference<string>(key + ':dashboard-scope', '');
  const status = normalizeRequirementStatusFilter(savedStatus);
  const sort: RequirementSort = ['deadline', 'risk', 'progress', 'updated'].includes(savedSort) ? savedSort as RequirementSort : 'risk';
  const scope: DashboardScope | '' = Object.hasOwn(dashboardScopeLabels, savedScope) ? savedScope as DashboardScope : '';
  const hasFilters = Boolean(group || search || status !== 'in_progress' || risk || personId || schedule || sort !== 'risk' || scope);

  function resetFilters(nextStatus = 'in_progress') {
    setGroup(''); setSearch(''); setStatus(nextStatus); setRisk(''); setPersonId(''); setSchedule(''); setScope(''); setSort('risk');
  }
  function selectScope(next: DashboardScope) {
    // A card is a complete preset: old search/person filters must not hide its matches.
    const nextStatus = next === 'in_progress' || next === 'not_started' ? next
      : next === 'recent_completed' ? 'completed' : next === 'recent_created' ? '' : 'unfinished';
    setGroup(''); setSearch(''); setStatus(nextStatus); setRisk(''); setPersonId(''); setSchedule('');
    setScope(next === 'in_progress' || next === 'not_started' ? '' : next);
  }
  function isScopeSelected(next: DashboardScope) {
    if (group || search || risk || personId || schedule) return false;
    if (next === 'in_progress' || next === 'not_started') return !scope && status === next;
    const expectedStatus = next === 'recent_completed' ? 'completed' : next === 'recent_created' ? '' : 'unfinished';
    return scope === next && status === expectedStatus;
  }
  return { search, setSearch, status, setStatus, risk, setRisk, personId, setPersonId, group, setGroup,
    schedule, setSchedule, sort, setSort, scope, setScope, hasFilters, resetFilters, selectScope, isScopeSelected };
}

export type ProjectGanttFilters = ReturnType<typeof useProjectGanttFilters>;
