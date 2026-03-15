import { describe, it, expect } from "vitest";
import {
  toISODate,
  parseISODateJST,
  parseISODateTimeJST,
  toMD,
  diffDays,
  addDays,
  getWeekdayIndexInTimeZone,
  formatISODateParts,
} from "@/lib/datetime";

describe("toISODate", () => {
  it("JST 2026-03-15 00:00 をそのまま返す", () => {
    // UTC+9 の 2026-03-15 00:00 = UTC 2026-03-14 15:00
    const d = new Date("2026-03-14T15:00:00.000Z");
    expect(toISODate(d)).toBe("2026-03-15");
  });

  it("JST 深夜 0:00 境界（UTCでは前日）でも正しい日付を返す", () => {
    // UTC+9 の 2026-03-15 00:00 (UTC 2026-03-14T15:00:00Z)
    const d = new Date("2026-03-14T15:00:00.000Z");
    expect(toISODate(d)).toBe("2026-03-15");
  });
});

describe("formatISODateParts", () => {
  it("ゼロパディングして YYYY-MM-DD を返す", () => {
    expect(formatISODateParts(2026, 3, 5)).toBe("2026-03-05");
    expect(formatISODateParts(2026, 12, 31)).toBe("2026-12-31");
  });
});

describe("parseISODateJST", () => {
  it("有効な ISO 日付文字列を Date に変換する", () => {
    const d = parseISODateJST("2026-03-15");
    expect(d).not.toBeNull();
    // JST 2026-03-15 00:00 = UTC 2026-03-14 15:00:00
    expect(d!.toISOString()).toBe("2026-03-14T15:00:00.000Z");
  });

  it("不正なフォーマットは null を返す", () => {
    expect(parseISODateJST("20260315")).toBeNull();
    expect(parseISODateJST("")).toBeNull();
    expect(parseISODateJST("invalid")).toBeNull();
  });
});

describe("parseISODateTimeJST", () => {
  it("日付 + 時刻を UTC の Date に変換する", () => {
    // JST 2026-03-15 09:00 = UTC 2026-03-15 00:00
    const d = parseISODateTimeJST("2026-03-15", 9);
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("小数時刻（8.5 = 8:30）を正しく変換する", () => {
    // JST 2026-03-15 08:30 = UTC 2026-03-14T23:30:00Z
    const d = parseISODateTimeJST("2026-03-15", 8.5);
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2026-03-14T23:30:00.000Z");
  });

  it("不正な日付は null を返す", () => {
    expect(parseISODateTimeJST("invalid", 9)).toBeNull();
  });

  it("非有限の hour は null を返す", () => {
    expect(parseISODateTimeJST("2026-03-15", NaN)).toBeNull();
  });
});

describe("toMD", () => {
  it("月/日 形式で返す", () => {
    expect(toMD("2026-03-15")).toBe("3/15");
    expect(toMD("2026-01-01")).toBe("1/1");
    expect(toMD("2026-12-31")).toBe("12/31");
  });
});

describe("diffDays", () => {
  it("同じ日は 0 を返す", () => {
    expect(diffDays("2026-03-15", "2026-03-15")).toBe(0);
  });

  it("翌日は 1 を返す", () => {
    expect(diffDays("2026-03-15", "2026-03-16")).toBe(1);
  });

  it("7日後は 7 を返す", () => {
    expect(diffDays("2026-03-01", "2026-03-08")).toBe(7);
  });

  it("マイナスも正しく計算する", () => {
    expect(diffDays("2026-03-16", "2026-03-15")).toBe(-1);
  });

  it("不正な入力は 0 を返す", () => {
    expect(diffDays("invalid", "2026-03-15")).toBe(0);
    expect(diffDays("2026-03-15", "invalid")).toBe(0);
  });
});

describe("addDays", () => {
  it("指定した日数を加算する", () => {
    const base = new Date("2026-03-14T15:00:00.000Z"); // JST 2026-03-15
    const result = addDays(base, 7);
    expect(result.toISOString()).toBe("2026-03-21T15:00:00.000Z");
  });

  it("元の Date を変更しない（イミュータブル）", () => {
    const base = new Date("2026-03-14T15:00:00.000Z");
    addDays(base, 5);
    expect(base.toISOString()).toBe("2026-03-14T15:00:00.000Z");
  });

  it("負の日数も正しく処理する", () => {
    const base = new Date("2026-03-14T15:00:00.000Z");
    const result = addDays(base, -1);
    expect(result.toISOString()).toBe("2026-03-13T15:00:00.000Z");
  });
});

describe("getWeekdayIndexInTimeZone", () => {
  it("月曜日は 1 を返す", () => {
    // 2026-03-16 は月曜日
    const d = new Date("2026-03-15T15:00:00.000Z"); // JST 2026-03-16
    expect(getWeekdayIndexInTimeZone(d)).toBe(1);
  });

  it("日曜日は 0 を返す", () => {
    // 2026-03-15 は日曜日
    const d = new Date("2026-03-14T15:00:00.000Z"); // JST 2026-03-15
    expect(getWeekdayIndexInTimeZone(d)).toBe(0);
  });
});
