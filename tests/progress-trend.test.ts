import { describe, expect, it } from "vitest";
import { dailyProgressTrend, progressHistoryMetadata, progressUpdateDisplayValue } from "../src/client/progress-trend";
import {deriveRequirementMetrics,requirementPlannedProgress} from '../src/shared/domain';

describe('需求计划进度',()=>{
  const item={status:'in_progress',progress:50,plannedStart:'2026-09-01',plannedEnd:'2026-09-04'};
  it('直接执行没有工作项时仍使用需求日期，拆分后保留基线',()=>{
    const direct={executionMode:'direct' as const,...item,plannedEnd:'2026-09-10'};
    expect(requirementPlannedProgress(direct,[],'2026-09-09')).toBe(88);
    const split={executionMode:'work_items' as const,splitBaseProgress:30};
    expect(requirementPlannedProgress(split,[item],'2026-09-03')).toBe(83);
    expect(requirementPlannedProgress(split,[item],'2026-09-03')).toBe(deriveRequirementMetrics(split,[item],'2026-09-03').plannedProgress);
  });
  it('排期不完整时不伪造零进度，已取消工作项不影响有效计划',()=>{
    expect(requirementPlannedProgress({executionMode:'direct'},[],'2026-09-03')).toBeNull();
    expect(requirementPlannedProgress({},[item,{status:'not_started',plannedStart:null,plannedEnd:null}],'2026-09-03')).toBeNull();
    expect(requirementPlannedProgress({},[item,{status:'cancelled'}],'2026-09-03')).toBe(75);
  });
});

describe("进度趋势", () => {
  it("同一时间使用接口返回的最新记录，不比较随机ID", () => {
    expect(dailyProgressTrend([
      { id: "a-latest", percent: 80, createdAt: "2026-09-03T12:00:00.000Z" },
      { id: "z-earlier", percent: 20, createdAt: "2026-09-03T12:00:00.000Z" },
      { id: "older-day", percent: 10, createdAt: "2026-09-02T12:00:00.000Z" },
    ])).toEqual([
      { date: "2026-09-02", actualProgress: 10 },
      { date: "2026-09-03", actualProgress: 80 },
    ]);
  });

  it("按上海业务日期每天只保留最后一次需求进度", () => {
    expect(dailyProgressTrend([
      { id: "late", percent: 50, createdAt: "2026-09-03T12:00:00.000Z" },
      { id: "next-day", percent: 60, createdAt: "2026-09-03T16:00:00.000Z" },
      { id: "early", percent: 40, createdAt: "2026-09-03T01:00:00.000Z" },
    ])).toEqual([
      { date: "2026-09-03", actualProgress: 50 },
      { date: "2026-09-04", actualProgress: 60 },
    ]);
  });
});

describe("进展数字显示", () => {
  it("工作项说明不回退显示需求进度，需求记录仍显示需求快照", () => {
    expect(progressUpdateDisplayValue({ workItemId: "w1", workItemPercent: 40, percent: 70 })).toBe(40);
    expect(progressUpdateDisplayValue({ workItemId: "w1", workItemPercent: null, percent: 70 })).toBeNull();
    expect(progressUpdateDisplayValue({ workItemId: null, workItemPercent: null, percent: 70 })).toBe(70);
  });

  it("按同一工作项显示完成度变化和距上次记录耗时", () => {
    const metadata = progressHistoryMetadata([
      { id: "latest", requirementId: "r1", workItemId: "w1", workItemTitle: "联调", percent: 40, workItemPercent: 40, content: "推进", eventType: "progress", createdAt: "2026-09-04T17:07:33+08:00", updatedAt: "2026-09-04T17:07:33+08:00" },
      { id: "other", requirementId: "r1", workItemId: "w2", workItemTitle: "数据开发", percent: 30, workItemPercent: 90, content: "推进", eventType: "progress", createdAt: "2026-09-04T10:00:00+08:00", updatedAt: "2026-09-04T10:00:00+08:00" },
      { id: "start", requirementId: "r1", workItemId: "w1", workItemTitle: "联调", percent: 0, workItemPercent: 0, content: "开始工作项", eventType: "start", createdAt: "2026-09-03T20:12:17+08:00", updatedAt: "2026-09-03T20:12:17+08:00" },
    ]);
    expect(metadata.get("start")).toMatchObject({ transitionLabel: "首次 · 0%", elapsedLabel: "首次记录" });
    expect(metadata.get("latest")).toMatchObject({ transitionLabel: "0 → 40%", elapsedLabel: "20小时55分钟" });
  });
});
