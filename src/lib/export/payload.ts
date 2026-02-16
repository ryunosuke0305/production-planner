import type {
  Block,
  CalendarDay,
  DailyStockEntry,
  Density,
  ExportPayloadV1,
  Item,
  Material,
} from "@/types/planning";
import { toISODate } from "@/lib/datetime";
import { slotIndexFromDateTime } from "@/lib/slots";
import { slotLabelFromCalendar } from "@/lib/slots";

export function buildExportPayload(p: {
  weekStart: Date;
  timezone: string;
  density: Density;
  calendarDays: CalendarDay[];
  hoursByDay: Array<Array<number | null>>;
  slotsPerDay: number;
  slotCount: number;
  materials: Material[];
  items: Item[];
  blocks: Block[];
  dailyStocks: DailyStockEntry[];
  eodStocks: Array<{ itemId: string; itemCode: string; dates: string[]; stocks: number[] }>;
}): ExportPayloadV1 {
  const slotIndexToLabel = new Array(p.slotCount).fill("").map((_, i) =>
    slotLabelFromCalendar({
      density: p.density,
      calendarDays: p.calendarDays,
      hoursByDay: p.hoursByDay,
      slotIndex: i,
    })
  );
  const materialMap = new Map(p.materials.map((m) => [m.id, m]));
  const exportHours = p.hoursByDay[0]?.filter((hour): hour is number => hour !== null) ?? [];

  return {
    schemaVersion: "1.2.3",
    meta: {
      exportedAtISO: new Date().toISOString(),
      timezone: p.timezone,
      weekStartISO: toISODate(p.weekStart),
      horizonDays: 7,
      density: p.density,
      slotsPerDay: p.slotsPerDay,
      slotCount: p.slotCount,
      weekDates: p.calendarDays.map((day) => day.date),
      hours: exportHours,
      slotIndexToLabel,
    },
    items: p.items.map((it) => ({
      id: it.id,
      publicId: it.publicId,
      name: it.name,
      unit: it.unit,
      planningPolicy: it.planningPolicy,
      safetyStock: it.safetyStock,
      safetyStockAutoEnabled: it.safetyStockAutoEnabled,
      safetyStockLookbackDays: it.safetyStockLookbackDays,
      safetyStockCoefficient: it.safetyStockCoefficient,
      shelfLifeDays: it.shelfLifeDays,
      productionEfficiency: it.productionEfficiency,
      packagingEfficiency: it.packagingEfficiency,
      notes: it.notes,
      recipe: it.recipe.map((r) => ({
        materialId: r.materialId,
        materialName: materialMap.get(r.materialId)?.name ?? "未登録原料",
        perUnit: r.perUnit,
        unit: r.unit,
      })),
    })),
    materials: p.materials.map((m) => ({ ...m })),
    blocks: p.blocks.map((b) => {
      const startIndex =
        slotIndexFromDateTime(b.startAt, p.calendarDays, p.hoursByDay.map((day) => day.filter((h): h is number => h !== null)), p.slotsPerDay) ??
        Math.max(0, Math.trunc(b.start ?? 0));
      const endBoundaryIndex =
        slotIndexFromDateTime(
          b.endAt,
          p.calendarDays,
          p.hoursByDay.map((day) => day.filter((h): h is number => h !== null)),
          p.slotsPerDay,
          true
        ) ?? startIndex + Math.max(1, Math.trunc(b.len ?? 1));
      const blockLen = Math.max(1, endBoundaryIndex - startIndex);
      return {
        id: b.id,
        itemId: b.itemId,
        start: startIndex,
        len: blockLen,
        laneRow: b.laneRow,
        startLabel: slotLabelFromCalendar({
          density: p.density,
          calendarDays: p.calendarDays,
          hoursByDay: p.hoursByDay,
          slotIndex: startIndex,
        }),
        endLabel: slotLabelFromCalendar({
          density: p.density,
          calendarDays: p.calendarDays,
          hoursByDay: p.hoursByDay,
          slotIndex: Math.min(p.slotCount - 1, startIndex + blockLen - 1),
        }),
        amount: b.amount,
        memo: b.memo,
        approved: b.approved,
      };
    }),
    dailyStocks: p.dailyStocks.map((entry) => ({
      date: entry.date,
      itemCode: entry.itemCode,
      stock: entry.stock,
      shipped: entry.shipped,
    })),
    eodStocks: p.eodStocks.map((entry) => ({
      itemCode: entry.itemCode,
      dates: entry.dates,
      stocks: entry.stocks,
    })),
    constraints: {},
  };
}
