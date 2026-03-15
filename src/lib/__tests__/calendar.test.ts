import { describe, it, expect } from "vitest";
import { buildCalendarHours, buildCalendarDays, extendCalendarDaysTo } from "@/lib/calendar";
import type { CalendarDay } from "@/types/planning";

const workday: CalendarDay = {
  date: "2026-03-16",
  isHoliday: false,
  workStartHour: 8,
  workEndHour: 18,
};

const holiday: CalendarDay = {
  date: "2026-03-15",
  isHoliday: true,
  workStartHour: 8,
  workEndHour: 18,
};

describe("buildCalendarHours", () => {
  it("稼働日の hour density では workStartHour を 1要素で返す", () => {
    expect(buildCalendarHours(workday, "day")).toEqual([8]);
  });

  it("稼働日の hour density では 8〜17 の10要素を返す", () => {
    const hours = buildCalendarHours(workday, "hour");
    expect(hours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it("稼働日の 2hour density では 2時間刻みを返す", () => {
    const hours = buildCalendarHours(workday, "2hour");
    expect(hours).toEqual([8, 10, 12, 14, 16]);
  });

  it("休日は空配列を返す", () => {
    expect(buildCalendarHours(holiday, "hour")).toEqual([]);
    expect(buildCalendarHours(holiday, "day")).toEqual([]);
    expect(buildCalendarHours(holiday, "2hour")).toEqual([]);
  });

  it("workStartHour が異なる場合も正しく動作する", () => {
    const earlyDay: CalendarDay = { ...workday, workStartHour: 6, workEndHour: 14 };
    const hours = buildCalendarHours(earlyDay, "hour");
    expect(hours).toEqual([6, 7, 8, 9, 10, 11, 12, 13]);
  });
});

describe("buildCalendarDays", () => {
  it("指定日数分の CalendarDay を返す", () => {
    // 2026-03-16 (月) から 5日間
    const start = new Date("2026-03-15T15:00:00.000Z"); // JST 2026-03-16
    const days = buildCalendarDays(start, 5);
    expect(days).toHaveLength(5);
    expect(days[0]!.date).toBe("2026-03-16");
    expect(days[4]!.date).toBe("2026-03-20");
  });

  it("週末 (土日) は isHoliday = true になる", () => {
    // 2026-03-14 (土) から 2日間
    const start = new Date("2026-03-13T15:00:00.000Z"); // JST 2026-03-14 (土)
    const days = buildCalendarDays(start, 2);
    expect(days[0]!.isHoliday).toBe(true);  // 土曜
    expect(days[1]!.isHoliday).toBe(true);  // 日曜
  });

  it("平日は isHoliday = false になる", () => {
    // 2026-03-16 (月)
    const start = new Date("2026-03-15T15:00:00.000Z"); // JST 2026-03-16
    const days = buildCalendarDays(start, 1);
    expect(days[0]!.isHoliday).toBe(false);
  });

  it("デフォルト workStartHour/workEndHour が設定される", () => {
    const start = new Date("2026-03-15T15:00:00.000Z");
    const days = buildCalendarDays(start, 1);
    expect(days[0]!.workStartHour).toBe(8);
    expect(days[0]!.workEndHour).toBe(18);
  });
});

describe("extendCalendarDaysTo", () => {
  it("空配列はそのまま返す", () => {
    expect(extendCalendarDaysTo([], "2026-03-20")).toEqual([]);
  });

  it("targetEndISO が最終日以前なら拡張しない", () => {
    const days = buildCalendarDays(new Date("2026-03-15T15:00:00.000Z"), 5);
    const result = extendCalendarDaysTo(days, "2026-03-19");
    expect(result).toHaveLength(5);
  });

  it("targetEndISO が最終日以降なら追加分を足す", () => {
    const days = buildCalendarDays(new Date("2026-03-15T15:00:00.000Z"), 5);
    // 最終日 2026-03-20, target は 2026-03-22 → 2日追加
    const result = extendCalendarDaysTo(days, "2026-03-22");
    expect(result).toHaveLength(7);
    expect(result[5]!.date).toBe("2026-03-21");
    expect(result[6]!.date).toBe("2026-03-22");
  });
});
