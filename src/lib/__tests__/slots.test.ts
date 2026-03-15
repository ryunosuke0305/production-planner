import { describe, it, expect } from "vitest";
import {
  slotsPerDayForDensity,
  slotUnitsPerSlot,
  fromAbsoluteSlots,
  convertSlotIndex,
  clamp,
  xToSlotWithStep,
  endDayIndex,
} from "@/lib/slots";

describe("slotsPerDayForDensity", () => {
  it("day は 1 を返す", () => {
    expect(slotsPerDayForDensity("day")).toBe(1);
  });

  it("hour は BASE_SLOTS_PER_DAY (10) を返す", () => {
    // DEFAULT_WORK_END_HOUR(18) - DEFAULT_WORK_START_HOUR(8) = 10
    expect(slotsPerDayForDensity("hour")).toBe(10);
  });

  it("2hour は 5 を返す", () => {
    expect(slotsPerDayForDensity("2hour")).toBe(5);
  });
});

describe("slotUnitsPerSlot", () => {
  it("hour density では 1 を返す", () => {
    expect(slotUnitsPerSlot("hour")).toBe(1);
  });

  it("day density では 10 を返す（1スロット = 10 hour単位）", () => {
    expect(slotUnitsPerSlot("day")).toBe(10);
  });

  it("2hour density では 2 を返す", () => {
    expect(slotUnitsPerSlot("2hour")).toBe(2);
  });
});

describe("fromAbsoluteSlots", () => {
  it("hour density では 1:1 でマッピングされる", () => {
    expect(fromAbsoluteSlots(3, "hour", "floor")).toBe(3);
    expect(fromAbsoluteSlots(3.5, "hour", "floor")).toBe(3.5);
  });

  it("2hour density では絶対スロット2つが1スロットに対応する", () => {
    // abs=4, 2hour: 4/2=2 slots
    expect(fromAbsoluteSlots(4, "2hour", "floor")).toBe(2);
  });

  it("mode=ceil で切り上げる", () => {
    expect(fromAbsoluteSlots(3.3, "hour", "ceil")).toBe(3.5);
  });

  it("mode=round で四捨五入する", () => {
    expect(fromAbsoluteSlots(3.3, "hour", "round")).toBe(3.5);
    expect(fromAbsoluteSlots(3.2, "hour", "round")).toBe(3);
  });
});

describe("convertSlotIndex", () => {
  it("hour → hour は変換なし", () => {
    expect(convertSlotIndex(5, "hour", "hour", "floor")).toBe(5);
  });

  it("2hour → hour は2倍にする", () => {
    // 2hourの3スロット = abs 6 = hour 6スロット
    expect(convertSlotIndex(3, "2hour", "hour", "floor")).toBe(6);
  });

  it("hour → 2hour は1/2にする", () => {
    expect(convertSlotIndex(4, "hour", "2hour", "floor")).toBe(2);
  });
});

describe("clamp", () => {
  it("範囲内の値はそのまま返す", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("最小値より小さい場合は最小値を返す", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });

  it("最大値より大きい場合は最大値を返す", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("0.5スロット単位も正しくクランプする", () => {
    expect(clamp(0.3, 0.5, 5)).toBe(0.5);
  });
});

describe("xToSlotWithStep", () => {
  const rect = { left: 0, width: 1000 };

  it("左端は 0 を返す", () => {
    expect(xToSlotWithStep(0, rect, 10, 1)).toBe(0);
  });

  it("右端付近は最後のスロットを返す", () => {
    expect(xToSlotWithStep(999, rect, 10, 1)).toBe(9);
  });

  it("中間 50% は スロット5 を返す", () => {
    expect(xToSlotWithStep(500, rect, 10, 1)).toBe(5);
  });

  it("width=0 でも 0 を返してクラッシュしない", () => {
    expect(xToSlotWithStep(500, { left: 0, width: 0 }, 10, 1)).toBe(0);
  });

  it("step=0.5 のとき 0.5 単位でスナップされる", () => {
    // width=1000, slotCount=10, step=0.5 → scaledSlotCount=20
    // clientX=250 → ratio=0.25 → raw=floor(0.25*20)=5 → snapped=5*0.5=2.5
    expect(xToSlotWithStep(250, rect, 10, 0.5)).toBe(2.5);
  });
});

describe("endDayIndex", () => {
  it("1スロット幅のブロックの終了日インデックスを返す", () => {
    // start=2, len=1, slotsPerDay=5 → end slot = 2, dayIdx = 0
    expect(endDayIndex({ start: 2, len: 1 }, 5)).toBe(0);
  });

  it("複数日にまたがるブロックを正しく計算する", () => {
    // start=8, len=3, slotsPerDay=5 → end slot = 10, dayIdx = 2
    expect(endDayIndex({ start: 8, len: 3 }, 5)).toBe(2);
  });

  it("0.5スロット長の境界値", () => {
    // start=4, len=0.5, slotsPerDay=5 → end slot = 3.5, dayIdx = 0
    expect(endDayIndex({ start: 4, len: 0.5 }, 5)).toBe(0);
  });
});
