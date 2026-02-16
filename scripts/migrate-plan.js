import fs from "node:fs/promises";
import path from "node:path";
import { openPlanDatabase, savePlanPayload } from "./plan-db.js";

const planJsonPath = path.resolve(process.cwd(), "data", "plan.json");

const SLOT_HOURS = {
  hour: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  "2hour": [8, 10, 12, 14, 16],
  day: [8],
};

function slotsPerDay(density) {
  return SLOT_HOURS[density]?.length ?? SLOT_HOURS.hour.length;
}

function addDaysISO(baseISO, days) {
  const base = new Date(`${baseISO}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const d = new Date(base);
  d.setDate(base.getDate() + days);
  return toISODate(d);
}

function legacySlotToISODateTime(weekStartISO, density, slotIndex, asBoundary = false) {
  const perDay = slotsPerDay(density);
  const safeSlot = Math.max(0, Math.trunc(slotIndex));
  const dayIndex = Math.floor(safeSlot / perDay);
  const slotInDay = safeSlot % perDay;
  const dateISO = addDaysISO(weekStartISO, dayIndex);
  if (!dateISO) return null;
  const dayHours = SLOT_HOURS[density] ?? SLOT_HOURS.hour;
  const hour = asBoundary ? (slotInDay >= dayHours.length ? 18 : dayHours[slotInDay]) : dayHours[slotInDay];
  if (!Number.isFinite(hour)) return null;
  return new Date(`${dateISO}T${String(hour).padStart(2, "0")}:00:00.000Z`).toISOString();
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeDensity(value) {
  if (value === "hour" || value === "2hour" || value === "day") return value;
  return "hour";
}

function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildDefaultCalendarDays(weekStartISO) {
  const base = new Date(weekStartISO);
  if (Number.isNaN(base.getTime())) return [];
  const out = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const weekday = d.getDay();
    out.push({
      date: toISODate(d),
      isHoliday: weekday === 0 || weekday === 6,
      workStartHour: 8,
      workEndHour: 18,
    });
  }
  return out;
}

function parsePlanPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const record = raw;
  const weekStartISO = asString(record.weekStartISO).trim();
  if (!weekStartISO) return null;
  const materials = asArray(record.materials)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const material = entry;
      const id = asString(material.id).trim();
      const name = asString(material.name).trim();
      const unit = asString(material.unit).trim();
      if (!id || !name || !unit) return null;
      return { id, name, unit };
    })
    .filter(Boolean);

  const items = asArray(record.items)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const item = entry;
      const id = asString(item.id).trim();
      const publicId = asString(item.publicId || item.public_id || item.itemKey || item.item_key).trim();
      const name = asString(item.name).trim();
      const unit = asString(item.unit).trim();
      if (!id || !name || !unit) return null;
      const planningPolicy = asString(item.planningPolicy || item.planning_policy).trim();
      const safetyStock = asNumber(item.safetyStock ?? item.safety_stock, 0);
      const safetyStockAutoEnabled = asBoolean(
        item.safetyStockAutoEnabled ??
          item.safety_stock_auto_enabled ??
          item.safetyStockAuto ??
          item.safety_stock_auto ??
          item.safetyStockAutoCalc ??
          item.safety_stock_auto_calc,
        false
      );
      const safetyStockLookbackDays = asNumber(
        item.safetyStockLookbackDays ??
          item.safety_stock_lookback_days ??
          item.safetyStockDays ??
          item.safety_stock_days ??
          item.safetyStockRefDays ??
          item.safety_stock_ref_days,
        7
      );
      const safetyStockCoefficient = asNumber(
        item.safetyStockCoefficient ??
          item.safety_stock_coefficient ??
          item.safetyStockFactor ??
          item.safety_stock_factor ??
          item.safetyStockMultiplier ??
          item.safety_stock_multiplier,
        1
      );
      const shelfLifeDays = asNumber(
        item.shelfLifeDays ?? item.shelf_life_days ?? item.expirationDays ?? item.expiration_days ?? item.shelfLife,
        0
      );
      const productionEfficiency = asNumber(item.productionEfficiency ?? item.production_efficiency ?? item.efficiency, 0);
      const packagingEfficiency = asNumber(
        item.packagingEfficiency ?? item.packaging_efficiency ?? item.packEfficiency ?? item.pack_efficiency,
        1
      );
      const notes = asString(item.notes ?? item.note ?? item.memo ?? item.remark ?? item.remarks);
      const reorderPoint = asNumber(item.reorderPoint ?? item.reorder_point, 0);
      const lotSize = asNumber(item.lotSize ?? item.lot_size, 0);
      const recipe = asArray(item.recipe)
        .map((line) => {
          if (!line || typeof line !== "object") return null;
          const lineRecord = line;
          const materialId = asString(lineRecord.materialId).trim();
          const recipeUnit = asString(lineRecord.unit).trim();
          if (!materialId || !recipeUnit) return null;
          return {
            materialId,
            perUnit: asNumber(lineRecord.perUnit, 0),
            unit: recipeUnit,
          };
        })
        .filter(Boolean);
      return {
        id,
        publicId: publicId || undefined,
        name,
        unit,
        stock: asNumber(item.stock, 0),
        planningPolicy: planningPolicy === "make_to_order" ? "make_to_order" : "make_to_stock",
        safetyStock: Math.max(0, safetyStock),
        safetyStockAutoEnabled,
        safetyStockLookbackDays: Math.max(0, safetyStockLookbackDays),
        safetyStockCoefficient: Math.max(0, safetyStockCoefficient),
        shelfLifeDays: Math.max(0, shelfLifeDays),
        productionEfficiency: Math.max(0, productionEfficiency),
        packagingEfficiency: Math.max(0, packagingEfficiency),
        notes,
        reorderPoint: Math.max(0, reorderPoint),
        lotSize: Math.max(0, lotSize),
        recipe,
      };
    })
    .filter(Boolean);

  const blocks = asArray(record.blocks)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const block = entry;
      const id = asString(block.id).trim();
      const itemId = asString(block.itemId).trim();
      if (!id || !itemId) return null;
      const start = Math.trunc(asNumber(block.start, 0));
      const len = Math.max(1, Math.trunc(asNumber(block.len, 1)));
      return {
        id,
        itemId,
        start,
        len,
        startAt: asString(block.startAt || block.start_at).trim() || legacySlotToISODateTime(weekStartISO, normalizeDensity(record.density), start, false),
        endAt:
          asString(block.endAt || block.end_at).trim() ||
          legacySlotToISODateTime(weekStartISO, normalizeDensity(record.density), start + len, true),
        amount: asNumber(block.amount, 0),
        memo: asString(block.memo),
        approved: asBoolean(block.approved, false),
      };
    })
    .filter(Boolean);

  return {
    version: Number(record.version) === 1 ? 1 : 1,
    weekStartISO,
    density: normalizeDensity(record.density),
    calendarDays: buildDefaultCalendarDays(weekStartISO),
    materials,
    items,
    blocks,
  };
}

async function main() {
  let raw;
  try {
    raw = await fs.readFile(planJsonPath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      console.log("data/plan.json が存在しないため移行をスキップしました。");
      return;
    }
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("data/plan.json の JSON 解析に失敗しました。");
    process.exitCode = 1;
    return;
  }

  const payload = parsePlanPayload(parsed);
  if (!payload) {
    console.error("data/plan.json の内容がスキーマ要件を満たしていません。");
    process.exitCode = 1;
    return;
  }

  const db = await openPlanDatabase();
  try {
    savePlanPayload(db, payload);
  } finally {
    db.close();
  }

  console.log("data/plan.json から SQLite への移行が完了しました。");
}

main().catch((error) => {
  console.error("移行中にエラーが発生しました:", error);
  process.exitCode = 1;
});
