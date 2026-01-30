import { BASE_SLOTS_PER_DAY } from "@/constants/planning";
import { buildCalendarHours } from "@/lib/calendar";
import { parseISODateTimeJST, toMD, toISODate } from "@/lib/datetime";
import type { CalendarDay, CalendarSlots, Density, PlanSnapshot } from "@/types/planning";

export function buildCalendarSlots(calendarDays: CalendarDay[], density: Density): CalendarSlots {
  const rawHoursByDay = calendarDays.map((day) => buildCalendarHours(day, density));
  const slotsPerDay = Math.max(1, ...rawHoursByDay.map((hours) => hours.length));
  const hoursByDay = rawHoursByDay.map((hours) => {
    const padded: Array<number | null> = [...hours];
    while (padded.length < slotsPerDay) padded.push(null);
    return padded;
  });
  return {
    rawHoursByDay,
    hoursByDay,
    slotsPerDay,
    slotCount: calendarDays.length * slotsPerDay,
  };
}

export function slotsPerDayForDensity(density: Density): number {
  if (density === "day") return 1;
  if (density === "2hour") return Math.max(1, Math.ceil(BASE_SLOTS_PER_DAY / 2));
  return BASE_SLOTS_PER_DAY;
}

export function slotUnitsPerSlot(density: Density): number {
  return BASE_SLOTS_PER_DAY / slotsPerDayForDensity(density);
}

export function fromAbsoluteSlots(abs: number, density: Density, mode: "floor" | "ceil" | "round"): number {
  const raw = abs / slotUnitsPerSlot(density);
  if (mode === "floor") return Math.floor(raw);
  if (mode === "ceil") return Math.ceil(raw);
  return Math.round(raw);
}

export function convertSlotIndex(value: number, from: Density, to: Density, mode: "floor" | "ceil" | "round"): number {
  return fromAbsoluteSlots(value * slotUnitsPerSlot(from), to, mode);
}

export function convertSlotLength(value: number, from: Density, to: Density, mode: "ceil" | "round"): number {
  const abs = value * slotUnitsPerSlot(from);
  return Math.max(1, fromAbsoluteSlots(abs, to, mode));
}

export function slotLabelFromCalendar(p: {
  density: Density;
  calendarDays: CalendarDay[];
  hoursByDay: Array<Array<number | null>>;
  slotIndex: number;
}): string {
  const perDay = p.hoursByDay[0]?.length ?? 0;
  if (!perDay) return "";
  const dayIdx = Math.floor(p.slotIndex / perDay);
  const hourIdx = p.slotIndex % perDay;
  const day = p.calendarDays[dayIdx];
  const hour = p.hoursByDay[dayIdx]?.[hourIdx];
  if (!day || hour === null || hour === undefined) return "";
  return p.density === "day" ? `${toMD(day.date)}` : `${toMD(day.date)} ${hour}:00`;
}

export function buildPlanSnapshot(calendarDays: CalendarDay[], density: Density): PlanSnapshot {
  const calendarSlots = buildCalendarSlots(calendarDays, density);
  const slotIndexToLabel = Array.from({ length: calendarSlots.slotCount }, (_, i) =>
    slotLabelFromCalendar({
      density,
      calendarDays,
      hoursByDay: calendarSlots.hoursByDay,
      slotIndex: i,
    })
  );
  return {
    calendarDays,
    calendarSlots,
    slotIndexToLabel,
    slotCount: calendarSlots.slotCount,
  };
}

export function buildSlotHeaderLabels(hoursByDay: Array<Array<number | null>>, density: Density): string[] {
  const slotsPerDay = hoursByDay[0]?.length ?? 0;
  return Array.from({ length: slotsPerDay }, (_, slotIdx) => {
    if (density === "day") return "日";
    const hour = hoursByDay.map((day) => day[slotIdx]).find((value) => value !== null && value !== undefined);
    return hour === null || hour === undefined ? "" : `${hour}:00`;
  });
}

export function slotToDateTime(
  slotIndex: number,
  calendarDays: CalendarDay[],
  rawHoursByDay: Array<number[]>,
  slotsPerDay: number
): Date | null {
  const dayIdx = Math.floor(slotIndex / slotsPerDay);
  const slotIdx = slotIndex % slotsPerDay;
  const day = calendarDays[dayIdx];
  const hour = rawHoursByDay[dayIdx]?.[slotIdx];
  if (!day || hour === undefined) return null;
  const date = parseISODateTimeJST(day.date, hour);
  return date ?? null;
}

export function slotBoundaryToDateTime(
  boundaryIndex: number,
  calendarDays: CalendarDay[],
  rawHoursByDay: Array<number[]>,
  slotsPerDay: number
): Date | null {
  const dayIdx = Math.floor(boundaryIndex / slotsPerDay);
  const slotIdx = boundaryIndex % slotsPerDay;
  const day = calendarDays[dayIdx];
  if (!day) return null;
  const dayHours = rawHoursByDay[dayIdx] ?? [];
  if (slotIdx > dayHours.length) return null;
  const hour = slotIdx === dayHours.length ? day.workEndHour : dayHours[slotIdx];
  if (hour === undefined) return null;
  const date = parseISODateTimeJST(day.date, hour);
  return date ?? null;
}

export function slotIndexFromDateTime(
  value: string,
  calendarDays: CalendarDay[],
  rawHoursByDay: Array<number[]>,
  slotsPerDay: number,
  allowEndBoundary = false
): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const date = toISODate(parsed);
  const hour = parsed.getHours();
  const dayIdx = calendarDays.findIndex((day) => day.date === date);
  if (dayIdx < 0) return null;
  const dayHours = rawHoursByDay[dayIdx] ?? [];
  const slotIdx = dayHours.findIndex((h) => h === hour);
  if (slotIdx >= 0) return dayIdx * slotsPerDay + slotIdx;
  if (allowEndBoundary && hour === calendarDays[dayIdx].workEndHour) {
    return dayIdx * slotsPerDay + dayHours.length;
  }
  return null;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function xToSlot(clientX: number, rect: { left: number; width: number }, slotCount: number): number {
  const x = clientX - rect.left;
  const w = rect.width;
  if (w <= 0) return 0;
  const ratio = x / w;
  const raw = Math.floor(ratio * slotCount);
  return clamp(raw, 0, slotCount - 1);
}

export function clampToWorkingSlot(dayIndex: number, slot: number, rawHoursByDay: Array<number[]>): number | null {
  const dayHours = rawHoursByDay[dayIndex] ?? [];
  if (!dayHours.length) return null;
  return clamp(slot, 0, dayHours.length - 1);
}

export function endDayIndex(b: { start: number; len: number }, slotsPerDay: number): number {
  const endSlot = b.start + b.len - 1;
  return Math.floor(endSlot / slotsPerDay);
}
