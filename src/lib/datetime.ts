import {
  DEFAULT_TIMEZONE,
  JST_OFFSET_MINUTES,
  MS_PER_DAY,
  MS_PER_MINUTE,
} from "@/constants/planning";

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export function toISODate(d: Date): string {
  return formatDateInTimeZone(d, DEFAULT_TIMEZONE);
}

export function formatISODateParts(y: number, m: number, d: number): string {
  const yyyy = String(y).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function parseISODateJST(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  const utcMs = Date.UTC(year, month - 1, day, 0, 0, 0) - JST_OFFSET_MINUTES * MS_PER_MINUTE;
  return new Date(utcMs);
}

export function parseISODateTimeJST(isoDate: string, hour: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (!Number.isFinite(hour)) return null;
  const wholeHour = Math.floor(hour);
  const minutes = Math.round((hour - wholeHour) * 60);
  const utcMs = Date.UTC(year, month - 1, day, wholeHour, minutes, 0) - JST_OFFSET_MINUTES * MS_PER_MINUTE;
  return new Date(utcMs);
}

export function toMD(isoDate: string): string {
  const parts = isoDate.split("-").map((v) => Number(v));
  const m = parts[1];
  const d = parts[2];
  return `${m}/${d}`;
}

export function toWeekday(isoDate: string): string {
  const date = parseISODateJST(isoDate);
  if (!date) return "";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: DEFAULT_TIMEZONE, weekday: "short" }).format(date);
}

const WEEKDAY_EN_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function getWeekdayIndexInTimeZone(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  const index = WEEKDAY_EN_SHORT.indexOf(weekday as (typeof WEEKDAY_EN_SHORT)[number]);
  return index >= 0 ? index : date.getDay();
}

export function addDays(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

export function diffDays(startISO: string, endISO: string): number {
  const start = parseISODateJST(startISO);
  const end = parseISODateJST(endISO);
  if (!start || !end) return 0;
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

export const getDefaultWeekStart = (): Date => {
  const todayISO = toISODate(new Date());
  const today = parseISODateJST(todayISO) ?? new Date();
  const day = getWeekdayIndexInTimeZone(today);
  const diffToMonday = (day + 6) % 7;
  return addDays(today, -diffToMonday);
};
