import { describe, it, expect } from "vitest";
import {
  asString,
  asNumber,
  asBoolean,
  normalizeHeader,
  normalizeDateInput,
  normalizeNumberInput,
  isEmptyRow,
  sanitizeBlocks,
  sanitizeItems,
  sanitizeMaterials,
  parsePlanPayload,
} from "@/lib/sanitize";

describe("asString", () => {
  it("文字列はそのまま返す", () => {
    expect(asString("hello")).toBe("hello");
    expect(asString("")).toBe("");
  });

  it("非文字列はフォールバックを返す", () => {
    expect(asString(123)).toBe("");
    expect(asString(null)).toBe("");
    expect(asString(undefined)).toBe("");
    expect(asString(123, "fallback")).toBe("fallback");
  });
});

describe("asNumber", () => {
  it("数値はそのまま返す", () => {
    expect(asNumber(5)).toBe(5);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(-3.5)).toBe(-3.5);
  });

  it("数値に変換できる文字列を変換する", () => {
    expect(asNumber("42")).toBe(42);
    expect(asNumber("3.14")).toBe(3.14);
  });

  it("NaN・無効値はフォールバックを返す", () => {
    expect(asNumber(NaN)).toBe(0);
    expect(asNumber("abc")).toBe(0);
    expect(asNumber(null)).toBe(0);
    expect(asNumber(undefined, 99)).toBe(99);
  });
});

describe("asBoolean", () => {
  it("boolean はそのまま返す", () => {
    expect(asBoolean(true)).toBe(true);
    expect(asBoolean(false)).toBe(false);
  });

  it("非 boolean はフォールバックを返す", () => {
    expect(asBoolean(1)).toBe(false);
    expect(asBoolean("true")).toBe(false);
    expect(asBoolean(null, true)).toBe(true);
  });
});

describe("normalizeHeader", () => {
  it("空白・大文字を正規化する", () => {
    expect(normalizeHeader("  品目 コード  ")).toBe("品目コード");
    expect(normalizeHeader("ItemCode")).toBe("itemcode");
    expect(normalizeHeader("ITEM CODE")).toBe("itemcode");
  });

  it("null/undefined は空文字を返す", () => {
    expect(normalizeHeader(null)).toBe("");
    expect(normalizeHeader(undefined)).toBe("");
  });
});

describe("normalizeDateInput", () => {
  it("null/undefined/空文字は null を返す", () => {
    expect(normalizeDateInput(null)).toBeNull();
    expect(normalizeDateInput(undefined)).toBeNull();
    expect(normalizeDateInput("")).toBeNull();
  });

  it("ISO 日付文字列を正規化する", () => {
    expect(normalizeDateInput("2026-03-15")).toBe("2026-03-15");
  });

  it("yyyymmdd 形式の文字列を変換する", () => {
    expect(normalizeDateInput("20260315")).toBe("2026-03-15");
  });

  it("yyyymmdd 形式の数値を変換する", () => {
    expect(normalizeDateInput(20260315)).toBe("2026-03-15");
  });

  it("スラッシュ区切りを変換する", () => {
    expect(normalizeDateInput("2026/3/15")).toBe("2026-03-15");
  });

  it("無効な文字列は null を返す", () => {
    expect(normalizeDateInput("invalid-date")).toBeNull();
  });
});

describe("normalizeNumberInput", () => {
  it("数値はそのまま返す", () => {
    expect(normalizeNumberInput(42)).toBe(42);
    expect(normalizeNumberInput(0)).toBe(0);
  });

  it("カンマ区切り数値文字列を変換する", () => {
    expect(normalizeNumberInput("1,234")).toBe(1234);
    expect(normalizeNumberInput("1,234.5")).toBe(1234.5);
  });

  it("通常の数値文字列を変換する", () => {
    expect(normalizeNumberInput("99")).toBe(99);
    expect(normalizeNumberInput("3.14")).toBe(3.14);
  });

  it("変換できない場合は null を返す", () => {
    expect(normalizeNumberInput("abc")).toBeNull();
    expect(normalizeNumberInput(null)).toBeNull();
    expect(normalizeNumberInput(undefined)).toBeNull();
  });
});

describe("isEmptyRow", () => {
  it("全セルが空なら true を返す", () => {
    expect(isEmptyRow([null, undefined, "", "   "])).toBe(true);
  });

  it("値があれば false を返す", () => {
    expect(isEmptyRow([null, "abc", ""])).toBe(false);
    expect(isEmptyRow([0])).toBe(false);
  });

  it("空配列は true を返す", () => {
    expect(isEmptyRow([])).toBe(true);
  });
});

describe("sanitizeBlocks", () => {
  const validBlock = {
    id: "b1",
    itemId: "ITEM-A",
    start: 2,
    len: 3,
    amount: 100,
    memo: "",
    approved: false,
    startAt: "2026-03-15T09:00:00.000Z",
    endAt: "2026-03-15T12:00:00.000Z",
  };

  it("有効なブロックをそのまま返す", () => {
    const result = sanitizeBlocks([validBlock]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("b1");
    expect(result[0]!.itemId).toBe("ITEM-A");
  });

  it("startAt/endAt が欠損したブロックはスキップする", () => {
    const block = { ...validBlock, startAt: "", endAt: "" };
    const errors: string[] = [];
    const result = sanitizeBlocks([block], { onError: (msg) => errors.push(msg) });
    expect(result).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it("id が欠損したブロックはスキップする", () => {
    const block = { ...validBlock, id: "" };
    const result = sanitizeBlocks([block]);
    expect(result).toHaveLength(0);
  });

  it("非配列は空配列を返す", () => {
    expect(sanitizeBlocks(null)).toEqual([]);
    expect(sanitizeBlocks(undefined)).toEqual([]);
    expect(sanitizeBlocks({})).toEqual([]);
  });

  it("approved はデフォルト false", () => {
    const block = { ...validBlock, approved: undefined };
    const result = sanitizeBlocks([block]);
    expect(result[0]!.approved).toBe(false);
  });
});

describe("sanitizeItems", () => {
  const validItem = {
    id: "ITEM-A",
    publicId: "CODE-A",
    name: "品目A",
    unit: "ケース",
    planningPolicy: "make_to_stock",
    safetyStock: 10,
    safetyStockAutoEnabled: false,
    safetyStockLookbackDays: 7,
    safetyStockCoefficient: 1,
    shelfLifeDays: 30,
    productionEfficiency: 100,
    packagingEfficiency: 1,
    notes: "",
    recipe: [],
  };

  it("有効なアイテムを返す", () => {
    const result = sanitizeItems([validItem]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("ITEM-A");
  });

  it("id/name/publicId が欠損したアイテムはスキップする", () => {
    expect(sanitizeItems([{ ...validItem, id: "" }])).toHaveLength(0);
    expect(sanitizeItems([{ ...validItem, name: "" }])).toHaveLength(0);
    expect(sanitizeItems([{ ...validItem, publicId: "" }])).toHaveLength(0);
  });

  it("非配列は空配列を返す", () => {
    expect(sanitizeItems(null)).toEqual([]);
  });
});

describe("sanitizeMaterials", () => {
  it("有効な原料を返す", () => {
    const result = sanitizeMaterials([{ id: "MAT-A", name: "原料A", unit: "kg" }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("MAT-A");
  });

  it("id/name が欠損した原料はスキップする", () => {
    expect(sanitizeMaterials([{ id: "", name: "原料A", unit: "kg" }])).toHaveLength(0);
    expect(sanitizeMaterials([{ id: "MAT-A", name: "", unit: "kg" }])).toHaveLength(0);
  });
});

describe("parsePlanPayload", () => {
  const validPayload = {
    version: 1,
    weekStartISO: "2026-03-16",
    density: "hour",
    calendarDays: [{ date: "2026-03-16", isHoliday: false, workStartHour: 8, workEndHour: 18 }],
    materials: [],
    items: [],
    blocks: [],
  };

  it("有効なペイロードをパースする", () => {
    const result = parsePlanPayload(validPayload);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(1);
    expect(result!.weekStartISO).toBe("2026-03-16");
  });

  it("version が 1 以外は null を返す", () => {
    expect(parsePlanPayload({ ...validPayload, version: 2 })).toBeNull();
    expect(parsePlanPayload({ ...validPayload, version: undefined })).toBeNull();
  });

  it("null/非オブジェクトは null を返す", () => {
    expect(parsePlanPayload(null)).toBeNull();
    expect(parsePlanPayload("string")).toBeNull();
    expect(parsePlanPayload(42)).toBeNull();
  });

  it("weekStartISO が空で calendarDays もなければ null を返す", () => {
    expect(parsePlanPayload({ ...validPayload, weekStartISO: "", calendarDays: [] })).toBeNull();
  });
});
