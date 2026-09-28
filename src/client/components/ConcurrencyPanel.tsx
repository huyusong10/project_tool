import * as reportingApi from '../features/reporting/api';
import { Button } from './Button';
import { Avatar } from './Avatar';
import { motionScrollBehavior } from "../motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { LocateFixed } from "lucide-react";

import { useBusinessDate, useProjects } from "../app-context";
import { keys } from "../query-keys";
import { usePageSearchParams } from "../use-page-view";
import type { PeopleConcurrency, Person } from "../types";
import { addCalendarDays } from "../../shared/domain";
import { EmptyState } from "./Feedback";
import { isTemporaryReadError } from '../api';
import { isValidIsoDate } from '../../shared/workday';
import { ConcurrencyDayDetails } from './ConcurrencyDayDetails';

export function ConcurrencyPanel({ people }: { people: Person[] }) {
  const client = useQueryClient();
  const { selectedProjectId } = useProjects();
  const { businessDate } = useBusinessDate();
  const [viewParams, setViewParams] = usePageSearchParams(['analysisPersonId', 'analysisJobTitle', 'concurrencyPersonId', 'concurrencyDate']);
  const personId = viewParams.get('analysisPersonId') || '';
  const jobTitle = viewParams.get('analysisJobTitle') || '';
  const detailPersonId = viewParams.get('concurrencyPersonId') || '', detailDate = viewParams.get('concurrencyDate') || '';
  const inspectDay = (personId?: string, date?: string) => setViewParams(current => {
    const next = new URLSearchParams(current);
    if (personId && date) { next.set('concurrencyPersonId', personId); next.set('concurrencyDate', date); }
    else { next.delete('concurrencyPersonId'); next.delete('concurrencyDate'); }
    return next;
  });
  const setFilters = (nextJobTitle: string, nextPersonId: string) => {
    setViewParams(current => {
      const next = new URLSearchParams(current);
      if (nextJobTitle) next.set('analysisJobTitle', nextJobTitle); else next.delete('analysisJobTitle');
      if (nextPersonId) next.set('analysisPersonId', nextPersonId); else next.delete('analysisPersonId');
      return next;
    });
  };
  const matrixScrollRef = useRef<HTMLDivElement>(null);
  const matrixScrollLeftRef = useRef(0);
  const [matrixViewportWidth, setMatrixViewportWidth] = useState(0);
  const jobTitles = useMemo(() => [...new Set(people.map((person) => person.jobTitle).filter(Boolean) as string[])].sort(), [people]);
  const filteredPeople = people.filter((person) => !jobTitle || person.jobTitle === jobTitle);
  const analysisKey = [...keys.peopleConcurrency, selectedProjectId, personId, jobTitle, businessDate];
  const analysis = useInfiniteQuery({
    queryKey: analysisKey,
    initialPageParam: null as string | null,
    enabled: Boolean(selectedProjectId),
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("projectId", selectedProjectId);
      if (personId) params.set("personId", personId);
      if (jobTitle) params.set("jobTitle", jobTitle);
      if (pageParam) {
        params.set("from", pageParam);
        params.set("to", addCalendarDays(pageParam, 6));
      }
      try {
        return await reportingApi.analyticsPeopleConcurrencyQuery<PeopleConcurrency>(params, { signal });
      } catch (error) {
        if (!signal.aborted && !isTemporaryReadError(error)) client.setQueryData(analysisKey, null);
        throw error;
      }
    },
    retry: (failureCount, error) => failureCount < 1 && isTemporaryReadError(error),
    getNextPageParam: (lastPage) => addCalendarDays(lastPage.to, 1),
  });
  const pages = useMemo(() => analysis.data?.pages || [], [analysis.data?.pages]);
  const firstDate = pages[0]?.from || businessDate;
  const firstWindowEnd = pages[0]?.to || addCalendarDays(firstDate, 6);
  const asOfDate = pages[0]?.asOfDate || businessDate;
  const currentTop = pages[0]?.currentTop || [];
  const matrixData = useMemo(() => {
    type MatrixDay = PeopleConcurrency["people"][number]["days"][number];
    const dates = [...new Set(pages.flatMap((page) => page.dates))].sort();
    const mergedPeople = new Map<string, {
      id: string;
      name: string;
      jobTitle: string | null;
      externalCurrentCount?: number;
      daysByDate: Map<string, MatrixDay>;
    }>();
    for (const page of pages) {
      for (const person of page.people) {
        const merged = mergedPeople.get(person.id) || {
          id: person.id,
          name: person.name,
          jobTitle: person.jobTitle,
          externalCurrentCount: person.externalCurrentCount,
          daysByDate: new Map<string, MatrixDay>(),
        };
        for (const day of person.days) merged.daysByDate.set(day.date, day);
        mergedPeople.set(person.id, merged);
      }
    }
    const matrixPeople = [...mergedPeople.values()].map((person) => ({
      id: person.id,
      name: person.name,
      jobTitle: person.jobTitle,
      externalCurrentCount: person.externalCurrentCount,
      days: dates.map((date) => person.daysByDate.get(date) || {
        date,
        count: 0,
        plannedCount: 0,
        actualCount: 0,
        items: [],
      }),
    })).filter((person) => person.days.some((day) => day.count > 0));
    return { dates, people: matrixPeople };
  }, [pages]);
  const personColumnWidth = matrixViewportWidth > 0 && matrixViewportWidth < 900 ? 156 : 180;
  const initialDayCount = pages[0]?.dates.length || 5;
  const dayColumnWidth = Math.max(112, ((matrixViewportWidth || 960) - personColumnWidth) / initialDayCount);
  const tableWidth = Math.ceil(personColumnWidth + matrixData.dates.length * dayColumnWidth);
  const loadedTo = pages.at(-1)?.to || firstWindowEnd;
  const analysisUnavailable = Boolean(analysis.error && !analysis.data);

  useEffect(() => {
    const element = matrixScrollRef.current;
    if (!element) return undefined;
    matrixScrollLeftRef.current = element.scrollLeft;
    const updateWidth = () => setMatrixViewportWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [analysisUnavailable]);
  useEffect(() => {
    matrixScrollLeftRef.current = 0;
    matrixScrollRef.current?.scrollTo({ left: 0 });
  }, [firstDate, jobTitle, personId]);

  return <div className="people-analysis">
      <div className="filter-bar human-filter-bar">
      <select aria-label="分析岗位" value={jobTitle} onChange={(event) => setFilters(event.target.value, '')}><option value="">全部岗位</option>{jobTitle&&!jobTitles.includes(jobTitle)&&<option value={jobTitle}>{jobTitle}</option>}{jobTitles.map((title) => <option value={title} key={title}>{title}</option>)}</select>
      <select aria-label="分析人员" value={personId} onChange={(event) => setFilters(jobTitle, event.target.value)}><option value="">全部人员</option>{personId&&!filteredPeople.some(person=>person.id===personId)&&<option value={personId}>{people.find(person=>person.id===personId)?.name||'所选人员（不在当前列表）'}</option>}{filteredPeople.map((person) => <option value={person.id} key={person.id}>{person.name}</option>)}</select>
      <span>今天及历史看实际，未来看计划</span>
    </div>
    {analysisUnavailable ? <EmptyState title="人力分析加载失败" detail={analysis.error?.message || "暂时无法读取人员并发数据。"} action={<Button variant="secondary" className="ghost-button" disabled={analysis.isFetching} onClick={() => void analysis.refetch()}>重新加载</Button>} /> : <>
    {analysis.error && analysis.data && <div className="warning-banner">人力分析刷新失败，当前展示的是上次成功结果。<Button variant="secondary" className="ghost-button" disabled={analysis.isFetching} onClick={() => void analysis.refetch()}>重新加载</Button></div>}
    {currentTop.length > 0 && <section className="human-leaders" aria-label="今日工作最多人员">
      <strong>今日工作较多</strong>
      <div tabIndex={0}>{currentTop.map((person) => <article key={person.id}><Avatar name={person.name} className="person-avatar"/><div><b title={person.name}>{person.name}</b><small title={person.jobTitle || "岗位未设置"}>{person.jobTitle || "岗位未设置"}{person.externalCurrentCount ? ` · 外部${person.externalCurrentCount}项` : ""}</small></div><em className={`load-${Math.min(person.currentCount, 3)}`}>{person.currentCount}项</em></article>)}</div>
    </section>}
    <div className="human-matrix-frame">
      <header className="human-matrix-heading">
        <div><span>工作日并发度</span><strong>{format(parseISO(firstDate), "MM月dd日")}—{format(parseISO(firstWindowEnd), "MM月dd日")}</strong></div>
        <div><span>从今天开始 · 已加载至 {format(parseISO(loadedTo), "MM月dd日")}</span><Button variant="secondary" type="button" onClick={() => matrixScrollRef.current?.scrollTo({ left: 0, behavior: motionScrollBehavior() })}><LocateFixed size={14} />回到今天</Button></div>
      </header>
      <div className="human-matrix-scroll" ref={matrixScrollRef} onScroll={(event) => {
        const element = event.currentTarget;
        const movingRight = element.scrollLeft > matrixScrollLeftRef.current;
        matrixScrollLeftRef.current = element.scrollLeft;
        if (movingRight && element.scrollLeft + element.clientWidth >= element.scrollWidth - 140 && !analysis.isFetchingNextPage) void analysis.fetchNextPage();
      }}>
        <div className="human-matrix-content">
          <table className="human-continuous-table" style={{ width: tableWidth }} aria-label="人员工作日并发度矩阵">
            <colgroup><col style={{ width: personColumnWidth }} />{matrixData.dates.map((date) => <col style={{ width: dayColumnWidth }} key={date} />)}</colgroup>
            <thead><tr><th>人员</th>{matrixData.dates.map((date) => {
              const parsed = parseISO(date);
              return <th className={`${date === asOfDate ? "is-today" : ""}${parsed.getDay() === 1 && date !== asOfDate ? " is-week-start" : ""}`} key={date}><span>{["日", "一", "二", "三", "四", "五", "六"][parsed.getDay()]}</span>{date.slice(5).replace("-", "/")}</th>;
            })}</tr></thead>
            <tbody>
              {matrixData.people.map((person) => <tr key={person.id}><td><strong title={person.name}>{person.name}</strong><small title={person.jobTitle || "岗位未设置"}>{person.jobTitle || "—"}{person.externalCurrentCount ? ` · 外部${person.externalCurrentCount}项` : ""}</small></td>{person.days.map((day) => <td className={parseISO(day.date).getDay() === 1 && day.date !== asOfDate ? "is-week-start" : ""} key={day.date}>{day.count > 0 ? <Button variant="soft" tone={day.count >= 3 ? 'danger' : day.count === 2 ? 'warning' : 'success'} size="small" aria-label={`${person.name} ${day.date} ${day.count}项工作`} title="查看当天工作" onClick={() => inspectDay(person.id, day.date)}>{day.count}</Button> : <span className="heat heat-0" />}</td>)}</tr>)}
              {!matrixData.people.length && !analysis.isLoading && <tr className="human-empty-row"><td colSpan={matrixData.dates.length + 1}><div className="human-empty-message" style={{width:matrixViewportWidth||undefined}}><strong>当前区间暂无安排</strong><span>向右加载后续日期，或调整人员和岗位筛选。</span></div></td></tr>}
            </tbody>
          </table>
          <Button variant="secondary" size="small" className="human-next-window" disabled={analysis.isFetchingNextPage} onClick={() => void analysis.fetchNextPage()}>{analysis.isFetchingNextPage ? "加载中" : "加载后续7天"}</Button>
        </div>
      </div>
      <footer><span><i className="heat heat-1" />1项 正常</span><span><i className="heat heat-2" />2项 预警</span><span><i className="heat heat-3" />3项及以上 高并发</span><small>点击数量查看工作 · 横向拖动查看后续日期</small></footer>
    </div>
    </>}
    {detailPersonId && isValidIsoDate(detailDate) && <ConcurrencyDayDetails key={detailPersonId + ':' + detailDate} projectId={selectedProjectId} personId={detailPersonId} date={detailDate} onClose={() => inspectDay()} />}
    </div>;
}
