import type { AnalyticsDataRow, AnalyticsPanelResult } from '../shared/analytics';

/** A zero count is meaningful; a rate or average without a denominator is unavailable. */
export function analyticsValue(row: AnalyticsDataRow, unit: AnalyticsPanelResult['unit'], secondary = false): number | null {
  const count = secondary ? row.secondarySampleCount : row.sampleCount;
  if (unit !== 'count' && count === 0) return null;
  return secondary ? row.secondaryValue ?? null : row.value;
}
