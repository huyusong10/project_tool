import {addBusinessDays} from '../shared/domain';
import {DateRangeError} from '../shared/workday';

// Bound allocated view dates without limiting stored plan dates.
const maxGanttCalendarDays=36_600;
export function ganttRangeTooWide(start:string,end:string){
  return Date.parse(end)-Date.parse(start)>maxGanttCalendarDays*86_400_000;
}
export function shiftGanttDate(date:string,days:number){
  try{return addBusinessDays(date,days);}catch(error){
    if(error instanceof DateRangeError)return days<0?'0100-01-01':'9999-12-31';
    throw error;
  }
}

export function ganttWeekOffsets(dates: Date[], cellWidth: number) {
  return dates.flatMap((date, index) => date.getDay() === 1 ? [index * cellWidth] : []);
}
