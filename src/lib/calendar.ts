import { DEFAULT_WORK_END_HOUR, DEFAULT_WORK_START_HOUR, DAYS_IN_WEEK } from "@/constants/planning";
import type { CalendarDay, Density } from "@/types/planning";
import { addDays, diffDays, toISODate } from "@/lib/datetime";

export function buildCalendarDays(start: Date, days: number): CalendarDay[] {
  const out: CalendarDay[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = addDays(start, i);
    const isoDate = toISODate(d);
    const weekday = d.getDay();
    out.push({
      date: isoDate,
      isHoliday: weekday === 0 || weekday === 6,
      workStartHour: DEFAULT_WORK_START_HOUR,
      workEndHour: DEFAULT_WORK_END_HOUR,
    });
  }
  return out;
}

export function buildDefaultCalendarDays(start: Date): CalendarDay[] {
  return buildCalendarDays(start, DAYS_IN_WEEK);
}

export function extendCalendarDaysTo(calendarDays: CalendarDay[], targetEndISO: string): CalendarDay[] {
  if (!calendarDays.length) return calendarDays;
  const lastISO = calendarDays[calendarDays.length - 1]?.date;
  if (!lastISO) return calendarDays;
  const daysToAppend = diffDays(lastISO, targetEndISO);
  if (daysToAppend <= 0) return calendarDays;
  const appendStart = addDays(new Date(lastISO), 1);
  return [...calendarDays, ...buildCalendarDays(appendStart, daysToAppend)];
}

export function buildCalendarHours(day: CalendarDay, density: Density): number[] {
  if (day.isHoliday) return [];
  if (density === "day") return [day.workStartHour];
  const step = density === "2hour" ? 2 : 1;
  const out: number[] = [];
  for (let h = day.workStartHour; h < day.workEndHour; h += step) {
    out.push(h);
  }
  return out;
}
