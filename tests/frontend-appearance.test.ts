import { describe, expect, test } from "vitest";
import { resolveTheme, themes } from "../src/client/theme";
import { chartCategoryColor, resolveChartTokens } from "../src/client/chart-theme";
import { buildBusinessDayTimeline, businessDateIndex, ganttInterval, toGanttDate } from "../src/client/gantt-geometry";
import { requirementActualRange, workItemActualRange, workItemDisplayGap } from "../src/client/gantt-actual";
import type { Requirement, WorkItem } from "../src/client/types";

describe("appearance preferences", () => {
  test("six skins including DCIM preserve existing and legacy preferences", () => {
    expect(themes).toHaveLength(6);
    expect(resolveTheme("dcim")).toBe("dcim");
    expect(resolveTheme("light")).toBe("forest");
    expect(resolveTheme("dark")).toBe("midnight");
    expect(resolveTheme("invalid")).toBe("dcim");
    expect(resolveTheme(null)).toBe("dcim");
    for (const theme of themes) expect(resolveTheme(theme.id)).toBe(theme.id);
  });
  test("business category colors do not depend on series order", () => {
    expect(chartCategoryColor("risk", "high")).toBe("var(--danger)");
    expect(chartCategoryColor("risk", "medium")).toBe("var(--warning)");
    expect(chartCategoryColor("status", "completed")).toBe("var(--success)");
    expect(chartCategoryColor("owner", "some-id")).toBeUndefined();
  });
  test("chart colors resolve deeply without replacing formatter functions or source options", () => {
    const formatter = (value: number) => `${value}%`;
    const option = { series: [{ itemStyle: { color: "var(--accent)" } }], axisLabel: { formatter }, name: "进度" };
    const resolved = resolveChartTokens(option, () => "rgb(12,34,56)");
    expect(resolved.series).toEqual([{ itemStyle: { color: "rgb(12,34,56)" } }]);
    expect((resolved.axisLabel as { formatter: unknown }).formatter).toBe(formatter);
    expect(option.series[0].itemStyle.color).toBe("var(--accent)");
  });
});

describe("working-day date projection", () => {
  const dates = buildBusinessDayTimeline(["2026-09-01", "2026-10-15"], "day", "2026-09-07").dates;
  test("boundaries agree with a linear reference across holidays and adjusted weekends", () => {
    for (const value of ["2026-08-01", "2026-09-05", "2026-09-20", "2026-10-01", "2026-10-10", "2027-01-01"]) {
      const date = toGanttDate(value)!;
      const start = dates.findIndex((candidate) => candidate >= date);
      expect(businessDateIndex(date, dates, "start")).toBe(start < 0 ? dates.length : start);
      expect(businessDateIndex(date, dates, "end")).toBe(dates.reduce((last, candidate, index) => candidate <= date ? index : last, -1));
    }
  });
  test("same workday has one cell; a compressed holiday has a boundary point", () => {
    expect(ganttInterval("2026-09-07", "2026-09-07", dates, 40)?.width).toBe(40);
    expect(ganttInterval("2026-09-05", "2026-09-06", dates, 40)?.width).toBe(0);
  });
  test("missing, invalid and inverted dates never create an invented duration", () => {
    expect(ganttInterval(null, "2026-09-07", dates, 40)).toBeNull();
    expect(ganttInterval("2026-09-08", "2026-09-07", dates, 40)).toBeNull();
    expect(toGanttDate("2026-02-30")).toBeNull();
  });
});

describe("actual display cutoff", () => {
  const base = { status: "in_progress", actualStart: "2026-09-01", actualEnd: null, cancelledAt: null };
  test("running and blocked rows use the server observation date", () => {
    for (const status of ["in_progress", "blocked"]) expect(workItemActualRange({ ...base, status }, "2026-09-07")).toMatchObject({ end: "2026-09-07", ongoing: true });
  });
  test("cancelled rows freeze at cancellation, independently of today", () => {
    const item = { ...base, status: "cancelled", cancelledAt: "2026-09-03", plannedStart: "2026-09-01", plannedEnd: "2026-09-10" } as WorkItem;
    expect(workItemActualRange(item, "2026-09-30")).toMatchObject({ end: "2026-09-03", ongoing: false });
    expect(workItemDisplayGap(item, "2026-09-30").actualDuration).toBe(3);
  });
  test("terminal rows with missing endpoints stay unknown; incomplete rows stay unstarted", () => {
    expect(workItemActualRange({ ...base, status: "completed" }, "2026-09-30").end).toBeNull();
    expect(workItemActualRange({ ...base, status: "cancelled" }, "2026-09-30").end).toBeNull();
    expect(workItemActualRange({ ...base, actualStart: null }, "2026-09-30").end).toBeNull();
    expect(workItemActualRange({ ...base, actualStart: "2026-10-01" }, "2026-09-30").end).toBeNull();
  });
  test("early and late completion keep the actual end rather than the observation date", () => {
    for (const actualEnd of ["2026-09-03", "2026-09-18"]) {
      expect(workItemActualRange({ ...base, status: "completed", actualEnd }, "2026-09-30")).toEqual({ start: base.actualStart, end: actualEnd, ongoing: false });
    }
  });
  test("requirement spans use authoritative endpoints, including missing ones", () => {
    for (const status of ["in_progress", "pending_acceptance", "completed", "cancelled"]) {
      const requirement = { status, actualStart: "2026-09-01", actualEnd: "2026-09-03", workItems: [] } as unknown as Requirement;
      expect(requirementActualRange(requirement, "2026-09-30")).toEqual({ start: "2026-09-01", end: "2026-09-03" });
      expect(requirementActualRange({ ...requirement, actualEnd: null }, "2026-09-30").end).toBeNull();
    }
  });
});
