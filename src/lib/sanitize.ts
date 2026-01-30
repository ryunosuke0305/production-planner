import * as XLSX from "xlsx";
import {
  DEFAULT_ITEM_UNIT,
  DEFAULT_MATERIAL_UNIT,
  DEFAULT_PACKAGING_EFFICIENCY,
  DEFAULT_SAFETY_STOCK_COEFFICIENT,
  DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS,
  DEFAULT_WORK_END_HOUR,
  DEFAULT_WORK_START_HOUR,
  ITEM_UNITS,
} from "@/constants/planning";
import { formatISODateParts, parseISODateJST, toISODate } from "@/lib/datetime";
import type {
  Block,
  CalendarDay,
  Density,
  ImportHeaderOverrides,
  Item,
  ItemUnit,
  Material,
  PlanPayload,
  PlanningPolicy,
  RecipeLine,
  RecipeUnit,
} from "@/types/planning";

export function safeNumber(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function uid(prefix = "b"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export const DEFAULT_BLOCKS = (): Block[] => [
  { id: uid("b"), itemId: "A", start: 1, len: 2, amount: 40, memo: "", approved: false },
  { id: uid("b"), itemId: "B", start: 6, len: 2, amount: 30, memo: "段取り注意", approved: false },
];

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asSafetyStockAutoEnabled(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
    if (!normalized) return fallback;
    const disabled = ["0", "false", "no", "n", "off", "対象外", "無効", "不可", "停止", "なし", "無し", "×", "x"];
    const enabled = ["1", "true", "yes", "y", "on", "対象", "有効", "可", "自動", "auto", "○", "o"];
    if (disabled.includes(normalized)) return false;
    if (enabled.includes(normalized)) return true;
    if (normalized.includes("対象外")) return false;
    if (normalized.includes("対象")) return true;
  }
  return fallback;
}

export function asItemUnit(value: unknown): ItemUnit {
  if (typeof value !== "string") return DEFAULT_ITEM_UNIT;
  if (ITEM_UNITS.includes(value as ItemUnit)) return value as ItemUnit;
  if (value === "cs" || value === "case") return "ケース";
  if (value === "piece" || value === "pcs") return "ピース";
  if (value === "set") return "セット";
  return DEFAULT_ITEM_UNIT;
}

export function asPlanningPolicy(value: unknown): PlanningPolicy {
  return value === "make_to_order" ? "make_to_order" : "make_to_stock";
}

export function asRecipeUnit(value: unknown): RecipeUnit {
  if (typeof value !== "string") return DEFAULT_MATERIAL_UNIT;
  if (ITEM_UNITS.includes(value as RecipeUnit)) return value as RecipeUnit;
  if (value === "g") return "kg";
  return DEFAULT_MATERIAL_UNIT;
}

export function asDensity(value: unknown): Density {
  return value === "day" || value === "2hour" || value === "hour" ? value : "hour";
}

export function normalizeHeader(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, "").toLowerCase();
}

export function findHeaderIndex(headers: unknown[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const name of candidates) {
    const idx = normalized.indexOf(normalizeHeader(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function normalizeDateInput(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toISODate(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const asInt = Math.trunc(value);
    const asString = String(asInt);
    if (/^\d{8}$/.test(asString)) {
      return `${asString.slice(0, 4)}-${asString.slice(4, 6)}-${asString.slice(6, 8)}`;
    }
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) {
      return formatISODateParts(parsed.y, parsed.m, parsed.d);
    }
  }
  const asText = String(value).trim();
  if (/^\d{8}$/.test(asText)) {
    return `${asText.slice(0, 4)}-${asText.slice(4, 6)}-${asText.slice(6, 8)}`;
  }
  const parsedISO = parseISODateJST(asText);
  if (parsedISO) {
    return toISODate(parsedISO);
  }
  const slashMatch = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/.exec(asText);
  if (slashMatch) {
    return formatISODateParts(Number(slashMatch[1]), Number(slashMatch[2]), Number(slashMatch[3]));
  }
  const parsed = new Date(asText);
  if (!Number.isNaN(parsed.getTime())) {
    return toISODate(parsed);
  }
  return null;
}

export function normalizeNumberInput(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const fallback = Number(value);
  return Number.isFinite(fallback) ? fallback : null;
}

export function mergeHeaderCandidates(defaults: string[], override: string): string[] {
  const extras = override
    .split(/[,、\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...extras, ...defaults];
}

export function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

export const normalizeImportHeaderOverrides = (
  payload?: Partial<ImportHeaderOverrides> | null
): ImportHeaderOverrides => ({
  dailyStock: {
    date: typeof payload?.dailyStock?.date === "string" ? payload.dailyStock.date : "",
    itemCode: typeof payload?.dailyStock?.itemCode === "string" ? payload.dailyStock.itemCode : "",
    stock: typeof payload?.dailyStock?.stock === "string" ? payload.dailyStock.stock : "",
    shipped: typeof payload?.dailyStock?.shipped === "string" ? payload.dailyStock.shipped : "",
  },
});

export function sanitizeItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): Item | null => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = asString(record.id).trim();
      const publicId = asString(record.publicId ?? record.public_id ?? record.itemKey ?? record.item_key).trim();
      const name = asString(record.name).trim();
      if (!id || !name) return null;
      const unit = asItemUnit(record.unit);
      const planningPolicy = asPlanningPolicy(record.planningPolicy ?? record.planning_policy);
      const safetyStock = Math.max(0, asNumber(record.safetyStock ?? record.safety_stock));
      const safetyStockAutoEnabled = asSafetyStockAutoEnabled(
        record.safetyStockAutoEnabled ??
          record.safety_stock_auto_enabled ??
          record.safetyStockAuto ??
          record.safety_stock_auto ??
          record.safetyStockAutoCalc ??
          record.safety_stock_auto_calc,
        false
      );
      const safetyStockLookbackDays = Math.max(
        0,
        asNumber(
          record.safetyStockLookbackDays ??
            record.safety_stock_lookback_days ??
            record.safetyStockDays ??
            record.safety_stock_days ??
            record.safetyStockRefDays ??
            record.safety_stock_ref_days,
          DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS
        )
      );
      const safetyStockCoefficient = Math.max(
        0,
        asNumber(
          record.safetyStockCoefficient ??
            record.safety_stock_coefficient ??
            record.safetyStockFactor ??
            record.safety_stock_factor ??
            record.safetyStockMultiplier ??
            record.safety_stock_multiplier,
          DEFAULT_SAFETY_STOCK_COEFFICIENT
        )
      );
      const shelfLifeDays = Math.max(
        0,
        asNumber(
          record.shelfLifeDays ??
            record.shelf_life_days ??
            record.expirationDays ??
            record.expiration_days ??
            record.shelfLife ??
            record.shelf_life
        )
      );
      const productionEfficiency = Math.max(
        0,
        asNumber(record.productionEfficiency ?? record.production_efficiency ?? record.efficiency)
      );
      const packagingEfficiency = Math.max(
        0,
        asNumber(
          record.packagingEfficiency ?? record.packaging_efficiency ?? record.packEfficiency ?? record.pack_efficiency,
          DEFAULT_PACKAGING_EFFICIENCY
        )
      );
      const notes = asString(record.notes ?? record.note ?? record.memo ?? record.remark ?? record.remarks);
      const recipe = Array.isArray(record.recipe)
        ? record.recipe
            .map((r) => {
              if (!r || typeof r !== "object") return null;
              const rRecord = r as Record<string, unknown>;
              const materialId = asString(rRecord.materialId || rRecord.material).trim();
              if (!materialId) return null;
              return {
                materialId,
                perUnit: asNumber(rRecord.perUnit),
                unit: asRecipeUnit(rRecord.unit),
              };
            })
            .filter((r): r is RecipeLine => r !== null)
        : [];
      const item: Item = {
        id,
        publicId: publicId || undefined,
        name,
        unit,
        planningPolicy,
        safetyStock,
        safetyStockAutoEnabled,
        safetyStockLookbackDays,
        safetyStockCoefficient,
        shelfLifeDays,
        productionEfficiency,
        packagingEfficiency,
        notes,
        recipe,
      };
      return item;
    })
    .filter((item): item is Item => item !== null);
}

export function sanitizeMaterials(raw: unknown): Material[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = asString(record.id).trim();
      const name = asString(record.name).trim();
      if (!id || !name) return null;
      return {
        id,
        name,
        unit: asRecipeUnit(record.unit),
      } satisfies Material;
    })
    .filter((material): material is Material => material !== null);
}

export function sanitizeCalendarDays(raw: unknown): CalendarDay[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const date = asString(record.date).trim();
      if (!date) return null;
      return {
        date,
        isHoliday: asBoolean(record.isHoliday, false),
        workStartHour: asNumber(record.workStartHour, DEFAULT_WORK_START_HOUR),
        workEndHour: asNumber(record.workEndHour, DEFAULT_WORK_END_HOUR),
      } satisfies CalendarDay;
    })
    .filter((day): day is CalendarDay => day !== null);
}

export function sanitizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry): Block | null => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = asString(record.id).trim();
      const itemId = asString(record.itemId).trim();
      if (!id || !itemId) return null;
      const block: Block = {
        id,
        itemId,
        start: asNumber(record.start),
        len: Math.max(1, asNumber(record.len, 1)),
        amount: asNumber(record.amount),
        memo: asString(record.memo),
        approved: asBoolean(record.approved, false),
        createdBy: asString(record.createdBy || record.created_by),
        updatedBy: asString(record.updatedBy || record.updated_by),
        startAt: asString(record.startAt || record.start_at),
        endAt: asString(record.endAt || record.end_at),
      };
      return block;
    })
    .filter((block): block is Block => block !== null);
}

export function parsePlanPayload(raw: unknown): PlanPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;
  const calendarDays = sanitizeCalendarDays(record.calendarDays);
  const weekStartISO = asString(record.weekStartISO).trim() || calendarDays[0]?.date || "";
  if (!weekStartISO) return null;
  return {
    version: 1,
    weekStartISO,
    density: asDensity(record.density),
    calendarDays,
    materials: sanitizeMaterials(record.materials),
    items: sanitizeItems(record.items),
    blocks: sanitizeBlocks(record.blocks),
  };
}

export function mergeMaterialsFromItems(items: Item[], materials: Material[]): Material[] {
  const next = [...materials];
  const known = new Map(materials.map((m) => [m.id, m]));
  items.forEach((item) => {
    item.recipe.forEach((line) => {
      if (known.has(line.materialId)) return;
      const created: Material = {
        id: line.materialId,
        name: line.materialId,
        unit: line.unit,
      };
      known.set(created.id, created);
      next.push(created);
    });
  });
  return next;
}

export function extractJsonPayload(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1).trim();
}
