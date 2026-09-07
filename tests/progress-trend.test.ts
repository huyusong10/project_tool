import { describe, expect, it } from "vitest";
import { dailyProgressTrend, progressUpdateDisplayValue } from "../src/client/progress-trend";

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
});
