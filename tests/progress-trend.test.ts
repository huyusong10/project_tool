import { describe, expect, it } from "vitest";
import { dailyProgressTrend } from "../src/client/progress-trend";

describe("进度趋势", () => {
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
