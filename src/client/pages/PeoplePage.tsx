import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePageSearchParams, usePageScrollPosition } from "../use-page-view";
import { api } from "../api";
import { useProjects } from "../app-context";
import { keys } from "../query-keys";
import type { Person } from "../types";
import { EmptyState } from "../components/Feedback";
import { PageHeader } from "../components/PageHeader";
import { ConcurrencyPanel } from "../components/ConcurrencyPanel";
import { ViewTabs } from "../components/ViewTabs";
import { Avatar } from "../components/Avatar";

const emptyPeople: Person[] = [];

export function PeoplePage() {
  const { selectedProjectId, projects } = useProjects();
  const [viewParams, setViewParams] = usePageSearchParams(['view']);
  const view = viewParams.get("view") === "analysis" ? "analysis" : "matrix";
  const { data: loadedPeople, error, refetch, isFetching, isLoading } = useQuery({
    queryKey: [...keys.people, selectedProjectId],
    queryFn: ({ signal }) => api<Person[]>(`/api/people?projectId=${encodeURIComponent(selectedProjectId)}`, { signal }),
    enabled: Boolean(selectedProjectId),
  });
  usePageScrollPosition(!isLoading);
  const data = loadedPeople || emptyPeople;
  const listUnavailable = Boolean(error && !loadedPeople);
  const groups = useMemo(() => {
    const grouped = new Map<string, Person[]>();
    for (const person of data) {
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
  }, [data]);
  return (
    <>
      <PageHeader title="人员矩阵" />
      <div className="page-content">
        <ViewTabs
          className="people-subnav"
          ariaLabel="人员页面视图"
          options={[{ value: "matrix", label: "人员矩阵" }, { value: "analysis", label: "人力分析" }]}
          value={view}
          onChange={(next) => setViewParams(next === "matrix" ? {} : { view: "analysis" })}
        />
        {error && loadedPeople && <div className="warning-banner">人员列表刷新失败，当前展示的是上次成功结果。<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button></div>}
        {listUnavailable ? <EmptyState title="人员列表加载失败" detail={error?.message || "暂时无法读取项目人员。"} action={<button className="ghost-button" disabled={isFetching} onClick={() => void refetch()}>重新加载</button>} /> : view === "matrix" ? <>
        <div className="people-matrix">
          {groups.map((group, groupIndex) => (
            <section className="people-role-group" key={group.jobTitle} aria-labelledby={`role-group-${groupIndex}`}>
              <header>
                <div>
                  <span className="role-marker" />
                  <h2 id={`role-group-${groupIndex}`}>{group.jobTitle}</h2>
                </div>
                <span>{group.people.length}人</span>
              </header>
              <div className="people-role-members">
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
          {!data.length && !isLoading && (
            <EmptyState
              title="还没有人员"
              detail={`${projects.find((project) => project.id === selectedProjectId)?.name || "当前项目"}还没有项目成员。`}
            />
          )}
        </div>
        </> : <ConcurrencyPanel />}
      </div>
    </>
  );
}
