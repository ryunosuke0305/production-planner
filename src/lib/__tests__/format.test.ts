import { describe, it, expect } from "vitest";
import { formatQuantity, durationLabel } from "@/lib/format";

describe("formatQuantity", () => {
  it("整数は小数点なしで返す", () => {
    expect(formatQuantity(5)).toBe("5");
    expect(formatQuantity(100)).toBe("100");
  });

  it("有効な小数を返す", () => {
    expect(formatQuantity(1.5)).toBe("1.5");
    expect(formatQuantity(1.25)).toBe("1.25");
    expect(formatQuantity(1.125)).toBe("1.125");
  });

  it("末尾のゼロを除去する", () => {
    expect(formatQuantity(1.1)).toBe("1.1");
    expect(formatQuantity(1.10)).toBe("1.1");
  });

  it("NaN/Infinity は 0 を返す", () => {
    expect(formatQuantity(NaN)).toBe("0");
    expect(formatQuantity(Infinity)).toBe("0");
    expect(formatQuantity(-Infinity)).toBe("0");
  });

  it("0 は '0' を返す", () => {
    expect(formatQuantity(0)).toBe("0");
  });
});

describe("durationLabel", () => {
  it("day density は N日を返す", () => {
    expect(durationLabel(3, "day")).toBe("3日");
    expect(durationLabel(1, "day")).toBe("1日");
  });

  it("2hour density は N*2時間を返す", () => {
    expect(durationLabel(3, "2hour")).toBe("6時間");
    expect(durationLabel(1, "2hour")).toBe("2時間");
  });

  it("hour density はそのまま N時間を返す", () => {
    expect(durationLabel(5, "hour")).toBe("5時間");
    expect(durationLabel(1, "hour")).toBe("1時間");
  });
});
