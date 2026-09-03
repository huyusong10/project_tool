export function ganttWeekOffsets(dates: Date[], cellWidth: number) {
  return dates.flatMap((date, index) => date.getDay() === 1 ? [index * cellWidth] : []);
}
