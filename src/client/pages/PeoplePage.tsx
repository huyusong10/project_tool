import * as peopleApi from '../features/people/api';
import { Button } from '../components/Button';
import { useMemo, useState } from "react";
import { useResourceQuery } from "../use-resource-query";
import { usePageSearchParams, usePageScrollPosition } from "../use-page-view";

import { useProjects } from "../app-context";
import { keys } from "../query-keys";
import type { Person } from "../types";
import { EmptyState, LoadingState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { ConcurrencyPanel } from "../components/ConcurrencyPanel";
import { ViewTabs } from "../components/ViewTabs";
import { Avatar } from "../components/Avatar";
import { SearchInput } from '../components/SearchInput';
import { matchesSearch } from '../../shared/search';

const emptyPeople: Person[] = [];

export function PeoplePage() {
  const { selectedProjectId, projects } = useProjects();
  const [viewParams, setViewParams] = usePageSearchParams(['view','q','jobTitle']);
  const search = viewParams.get('q') || '', jobTitle = viewParams.get('jobTitle') || '';
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const updateView = (key: string, value: string) => setViewParams(current => { const next = new URLSearchParams(current); next.set(key, value); return next; });
  const view = viewParams.get("view") === "analysis" ? "analysis" : "matrix";
  const { data: loadedPeople, error, refetch, isFetching, isLoading } = useResourceQuery<Person[]>(
    [...keys.people, selectedProjectId],
    signal => peopleApi.peopleQuery<Person[]>(encodeURIComponent(selectedProjectId), { signal }),
    Boolean(selectedProjectId),
  );
  usePageScrollPosition(!isLoading);
  const data = loadedPeople || emptyPeople;
  const jobTitles = [...new Set(data.map(person => person.jobTitle?.trim() || '岗位未设置'))].sort();
  const listUnavailable = Boolean(error && !loadedPeople);
  const groups = useMemo(() => {
    const grouped = new Map<string, Person[]>();
    for (const person of data.filter(person => (!jobTitle || (person.jobTitle?.trim() || '岗位未设置') === jobTitle) && matchesSearch([person.name, person.jobTitle], search))) {
      const jobTitle = person.jobTitle?.trim() || "岗位未设置";
      grouped.set(jobTitle, [...(grouped.get(jobTitle) || []), person]);
    }
    return [...grouped.entries()]
      .sort(([left], [right]) => {
        if (left === "岗位未设置") return 1;
        if (right === "岗位未设置") return -1;
        return left.localeCompare(right, "zh-CN");
      })
      .map(([jobTitle, people]) => ({
        jobTitle,
        people: people.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
      }));
  }, [data, jobTitle, search]);
  return (
    <>
      <PageHeader title="人员矩阵" views={<ViewTabs
          ariaLabel="人员页面视图"
          options={[{ value: "matrix", label: "人员矩阵" }, { value: "analysis", label: "人力分析" }]}
          value={view}
          onChange={(next) => updateView('view', next)}
        />} />
      <div className="page-content">

        {error && loadedPeople && <div className="warning-banner">人员列表刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button></div>}
        {listUnavailable ? <EmptyState title="人员列表加载失败" detail={error?.message || "暂时无法读取项目人员。"} action={<Button variant="secondary" className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</Button>} /> : isLoading ? <LoadingState label="正在加载项目人员…" /> : view === "matrix" ? <>
        <div className="filter-bar"><SearchInput value={search} onChange={value => updateView('q', value)} placeholder="搜索姓名、岗位或拼音" /><select aria-label="岗位筛选" value={jobTitle} onChange={event => updateView('jobTitle', event.target.value)}><option value="">全部岗位</option>{jobTitle&&!jobTitles.includes(jobTitle)&&<option value={jobTitle}>{jobTitle}</option>}{jobTitles.map(title => <option key={title}>{title}</option>)}</select><span>{groups.reduce((sum, group) => sum + group.people.length, 0)} / {data.length} 人</span></div>
        <div className="people-matrix">
          {groups.map((group, groupIndex) => (
            <section className="people-role-group" key={group.jobTitle} aria-labelledby={`role-group-${groupIndex}`}>
              <header>
                <div>
                  <span className="role-marker" />
                  <h2 id={`role-group-${groupIndex}`}><button type="button" className="people-group-toggle" aria-expanded={Boolean(search || jobTitle) || !collapsed.has(group.jobTitle)} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(group.jobTitle)) next.delete(group.jobTitle); else next.add(group.jobTitle); return next; })}>{!search && !jobTitle && collapsed.has(group.jobTitle) ? '▸' : '▾'} {group.jobTitle}</button></h2>
                </div>
                <span>{group.people.length}人</span>
              </header>
              <div className="people-role-members" hidden={!search && !jobTitle && collapsed.has(group.jobTitle)}>
                {group.people.map((person) => (
                  <article className="person-card" key={person.id}>
                    <Avatar name={person.name} className="person-avatar" />
                    <div className="person-copy">
                      <strong>{person.name}</strong><small>{person.jobTitle || "岗位未设置"}</small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
          {!groups.length && (
            <EmptyState
              title={data.length ? '没有匹配的人员' : '还没有人员'}
              detail={data.length ? '调整姓名或岗位筛选。' : `${projects.find((project) => project.id === selectedProjectId)?.name || "当前项目"}还没有项目成员。`}
            />
          )}
        </div>
        </> : <ConcurrencyPanel people={data} />}
      </div>
    </>
  );
}
