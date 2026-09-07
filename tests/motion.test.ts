import { describe, expect, test } from "vitest";
import { chartAnimationEnabled } from "../src/client/motion";

const chart = (count: number) => ({ series: [{ data: Array(count).fill(1) }] });
describe("chart motion budget", () => {
  test("small visible charts can animate", () => {
    expect(chartAnimationEnabled(chart(30), false, false, true)).toBe(true);
  });
  test("large datasets and combined series skip animation", () => {
    expect(chartAnimationEnabled(chart(201), false, false, true)).toBe(false);
    expect(chartAnimationEnabled({ series: [...chart(120).series, ...chart(120).series] }, false, false, true)).toBe(false);
  });
  test("theme changes and hidden pages update immediately", () => {
    expect(chartAnimationEnabled(chart(30), false, true, true)).toBe(false);
    expect(chartAnimationEnabled(chart(30), false, false, false)).toBe(false);
  });
  test("reduced motion disables chart animation independently of data size", () => {
    expect(chartAnimationEnabled(chart(1), true, false, true)).toBe(false);
  });
});
