import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.resolve(process.cwd(), "data");
export const PLAN_DB_PATH = path.join(dataDir, "plan.sqlite");

const DEFAULT_WORK_START_HOUR = 8;
const DEFAULT_WORK_END_HOUR = 18;
const DEFAULT_PLAN_MATERIALS = [
  { id: "MAT-A", name: "原料A", unit: "kg" },
  { id: "MAT-B", name: "原料B", unit: "kg" },
  { id: "MAT-C", name: "原料C", unit: "kg" },
  { id: "MAT-D", name: "原料D", unit: "kg" },
  { id: "MAT-E", name: "原料E", unit: "kg" },
];
const DEFAULT_PLAN_ITEMS = [
  {
    id: "A",
    publicId: "ITEM-A",
    name: "Item A",
    unit: "ケース",
    planningPolicy: "make_to_stock",
    safetyStock: 20,
    safetyStockAutoEnabled: true,
    safetyStockLookbackDays: 14,
    safetyStockCoefficient: 1.1,
    shelfLifeDays: 30,
    productionEfficiency: 40,
    packagingEfficiency: 0.95,
    notes: "定番商品のため平準化。",
    recipe: [
      { materialId: "MAT-A", perUnit: 0.25, unit: "kg" },
      { materialId: "MAT-B", perUnit: 0.5, unit: "kg" },
    ],
  },
  {
    id: "B",
    publicId: "ITEM-B",
    name: "Item B",
    unit: "ケース",
    planningPolicy: "make_to_order",
    safetyStock: 10,
    safetyStockAutoEnabled: false,
    safetyStockLookbackDays: 7,
    safetyStockCoefficient: 1,
    shelfLifeDays: 7,
    productionEfficiency: 20,
    packagingEfficiency: 0.9,
    notes: "受注対応中心。",
    recipe: [
      { materialId: "MAT-A", perUnit: 0.1, unit: "kg" },
      { materialId: "MAT-C", perUnit: 0.2, unit: "kg" },
    ],
  },
  {
    id: "C",
    publicId: "ITEM-C",
    name: "Item C",
    unit: "kg",
    planningPolicy: "make_to_stock",
    safetyStock: 50,
    safetyStockAutoEnabled: true,
    safetyStockLookbackDays: 30,
    safetyStockCoefficient: 1.2,
    shelfLifeDays: 14,
    productionEfficiency: 60,
    packagingEfficiency: 0.88,
    notes: "週末の追加生産あり。",
    recipe: [
      { materialId: "MAT-D", perUnit: 0.35, unit: "kg" },
      { materialId: "MAT-E", perUnit: 0.05, unit: "kg" },
    ],
  },
];

const SLOT_HOURS = {
  hour: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  "2hour": [8, 10, 12, 14, 16],
  day: [8],
};

function slotsPerDay(density) {
  return SLOT_HOURS[density]?.length ?? SLOT_HOURS.hour.length;
}

function diffDays(from, to) {
  const fromDate = new Date(`${from}T00:00:00`);
  const toDate = new Date(`${to}T00:00:00`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return null;
  const ms = toDate.getTime() - fromDate.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function normalizeDensity(value) {
  if (value === "day" || value === "2hour" || value === "hour") return value;
  return "hour";
}

function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultWeekStartISO() {
  const today = new Date();
  const midnightUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const day = midnightUtc.getUTCDay();
  const diffToMonday = (day + 6) % 7;
  midnightUtc.setUTCDate(midnightUtc.getUTCDate() - diffToMonday);
  return toISODate(midnightUtc);
}

function buildDefaultCalendarDays(weekStartISO) {
  const base = new Date(`${weekStartISO}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(base);
    date.setUTCDate(base.getUTCDate() + index);
    const weekday = date.getUTCDay();
    return {
      date: toISODate(date),
      isHoliday: weekday === 0 || weekday === 6,
      workStartHour: DEFAULT_WORK_START_HOUR,
      workEndHour: DEFAULT_WORK_END_HOUR,
    };
  });
}

function buildDefaultPlanPayload() {
  const weekStartISO = getDefaultWeekStartISO();
  return {
    version: 1,
    weekStartISO,
    density: "hour",
    calendarDays: buildDefaultCalendarDays(weekStartISO),
    materials: DEFAULT_PLAN_MATERIALS,
    items: DEFAULT_PLAN_ITEMS,
    blocks: [],
  };
}

function dateTimeToLegacySlot(weekStartISO, density, value, asBoundary = false) {
  if (typeof value !== "string" || !value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getUTCFullYear();
  const m = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const d = String(parsed.getUTCDate()).padStart(2, "0");
  const dateISO = `${y}-${m}-${d}`;
  const dayDiff = diffDays(weekStartISO, dateISO);
  if (dayDiff === null) return null;
  const hour = parsed.getUTCHours();
  const dayHours = SLOT_HOURS[density] ?? SLOT_HOURS.hour;
  const slotIndex = dayHours.findIndex((h) => h === hour);
  if (slotIndex >= 0) return dayDiff * slotsPerDay(density) + slotIndex;
  if (asBoundary && hour === 18) return (dayDiff + 1) * slotsPerDay(density);
  return null;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS materials (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      unit TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      public_id TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock REAL NOT NULL,
      planning_policy TEXT NOT NULL DEFAULT 'make_to_stock',
      safety_stock REAL NOT NULL DEFAULT 0,
      safety_stock_auto_enabled INTEGER NOT NULL DEFAULT 0,
      safety_stock_lookback_days INTEGER NOT NULL DEFAULT 7,
      safety_stock_coefficient REAL NOT NULL DEFAULT 1,
      shelf_life_days INTEGER NOT NULL DEFAULT 0,
      production_efficiency REAL NOT NULL DEFAULT 0,
      packaging_efficiency REAL NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      reorder_point REAL NOT NULL DEFAULT 0,
      lot_size REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS item_recipes (
      item_id TEXT NOT NULL,
      material_id TEXT NOT NULL,
      per_unit REAL NOT NULL,
      unit TEXT NOT NULL,
      PRIMARY KEY (item_id, material_id),
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS blocks (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      lane_row INTEGER,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      amount REAL NOT NULL,
      memo TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      created_by TEXT,
      updated_by TEXT,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS daily_stocks (
      date TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      stock REAL NOT NULL,
      shipped REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (date, item_id)
    );
    CREATE TABLE IF NOT EXISTS calendar_days (
      date TEXT PRIMARY KEY,
      is_holiday INTEGER NOT NULL DEFAULT 0,
      work_start INTEGER NOT NULL,
      work_end INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_stocks_date ON daily_stocks(date);
    CREATE INDEX IF NOT EXISTS idx_daily_stocks_item ON daily_stocks(item_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_item ON blocks(item_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_item_start_at ON blocks(item_id, start_at);
  `);
}

export async function openPlanDatabase() {
  await fs.mkdir(dataDir, { recursive: true });
  const db = new Database(PLAN_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  return db;
}

export async function ensurePlanDatabaseSeeded() {
  await fs.mkdir(dataDir, { recursive: true });
  let hasExistingDb = true;
  try {
    await fs.access(PLAN_DB_PATH);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      hasExistingDb = false;
    } else {
      throw error;
    }
  }
  if (hasExistingDb) return false;

  const db = await openPlanDatabase();
  try {
    savePlanPayload(db, buildDefaultPlanPayload());
  } finally {
    db.close();
  }
  return true;
}

function loadMetaValue(db, key) {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  return row?.value ?? null;
}

const DEFAULT_IMPORT_HEADER_OVERRIDES = {
  dailyStock: {
    date: "",
    itemCode: "",
    stock: "",
    shipped: "",
  },
};

function normalizeImportHeaderOverrides(payload) {
  const toText = (value) => (typeof value === "string" ? value : "");
  return {
    dailyStock: {
      date: toText(payload?.dailyStock?.date),
      itemCode: toText(payload?.dailyStock?.itemCode),
      stock: toText(payload?.dailyStock?.stock),
      shipped: toText(payload?.dailyStock?.shipped),
    },
  };
}

export function loadPlanPayload(db, { from, to, itemId, itemName } = {}) {
  const metaRows = db.prepare("SELECT key, value FROM meta").all();
  if (!metaRows.length) return null;

  const meta = new Map(metaRows.map((row) => [row.key, row.value]));
  const calendarDays = db
    .prepare("SELECT date, is_holiday, work_start, work_end FROM calendar_days ORDER BY date")
    .all()
    .map((row) => ({
      date: row.date,
      isHoliday: Boolean(row.is_holiday),
      workStartHour: row.work_start,
      workEndHour: row.work_end,
    }));

  const weekStartISO = meta.get("weekStartISO") ?? calendarDays[0]?.date ?? "";
  if (!weekStartISO) return null;
  const density = normalizeDensity(meta.get("density"));
  const version = Number(meta.get("version") ?? 1);

  const materials = db
    .prepare("SELECT id, name, unit FROM materials ORDER BY id")
    .all()
    .map((row) => ({ id: row.id, name: row.name, unit: row.unit }));

  const items = db
    .prepare(
      "SELECT id, public_id, name, unit, stock, planning_policy, safety_stock, safety_stock_auto_enabled, safety_stock_lookback_days, safety_stock_coefficient, shelf_life_days, production_efficiency, packaging_efficiency, notes, reorder_point, lot_size FROM items ORDER BY id"
    )
    .all()
    .map((row) => ({
      id: row.id,
      publicId: row.public_id,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      planningPolicy: row.planning_policy ?? "make_to_stock",
      safetyStock: row.safety_stock ?? 0,
      safetyStockAutoEnabled: Boolean(row.safety_stock_auto_enabled),
      safetyStockLookbackDays: row.safety_stock_lookback_days ?? 7,
      safetyStockCoefficient: row.safety_stock_coefficient ?? 1,
      shelfLifeDays: row.shelf_life_days ?? 0,
      productionEfficiency: row.production_efficiency ?? 0,
      packagingEfficiency: row.packaging_efficiency ?? 1,
      notes: row.notes ?? "",
      reorderPoint: row.reorder_point ?? 0,
      lotSize: row.lot_size ?? 0,
    }));

  const recipeRows = db
    .prepare("SELECT item_id, material_id, per_unit, unit FROM item_recipes ORDER BY item_id")
    .all();
  const recipeMap = new Map();
  recipeRows.forEach((row) => {
    const list = recipeMap.get(row.item_id) ?? [];
    list.push({ materialId: row.material_id, perUnit: row.per_unit, unit: row.unit });
    recipeMap.set(row.item_id, list);
  });

  const itemsWithRecipes = items.map((item) => ({
    ...item,
    recipe: recipeMap.get(item.id) ?? [],
  }));

  const filterItemIds = new Set();
  const itemFilterActive = Boolean(itemId || itemName);
  if (itemId) {
    filterItemIds.add(itemId);
  }
  if (itemName) {
    const matched = db
      .prepare("SELECT id FROM items WHERE LOWER(name) LIKE ?")
      .all(`%${String(itemName).toLowerCase()}%`)
      .map((row) => row.id);
    matched.forEach((id) => filterItemIds.add(id));
  }

  const conditions = [];
  const params = [];
  if (itemFilterActive && filterItemIds.size === 0) {
    conditions.push("1 = 0");
  } else if (filterItemIds.size > 0) {
    const placeholders = Array.from(filterItemIds, () => "?").join(", ");
    conditions.push(`item_id IN (${placeholders})`);
    params.push(...filterItemIds);
  }

  if (from && to) {
    conditions.push("start_at <= ? AND end_at >= ?");
    params.push(`${to}T23:59:59`, `${from}T00:00:00`);
  }

  const sql = `SELECT id, item_id, lane_row, start_at, end_at, amount, memo, approved, created_by, updated_by FROM blocks${
    conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
  } ORDER BY start_at, id`;

  const blocks = db.prepare(sql).all(...params).map((row) => {
    const start = dateTimeToLegacySlot(weekStartISO, density, row.start_at, false) ?? 0;
    const endBoundary = dateTimeToLegacySlot(weekStartISO, density, row.end_at, true) ?? start + 1;
    return {
      id: row.id,
      itemId: row.item_id,
      start,
      len: Math.max(1, endBoundary - start),
      laneRow: Number.isFinite(row.lane_row) ? row.lane_row : undefined,
      startAt: row.start_at,
      endAt: row.end_at,
      amount: row.amount,
      memo: row.memo,
      approved: Boolean(row.approved),
      createdBy: row.created_by ?? undefined,
      updatedBy: row.updated_by ?? undefined,
    };
  });

  return {
    version: Number.isFinite(version) ? version : 1,
    weekStartISO,
    density,
    calendarDays,
    materials,
    items: itemsWithRecipes,
    blocks,
  };
}

export function loadDailyStocks(db) {
  const entries = db
    .prepare("SELECT date, item_id, item_code, stock, shipped FROM daily_stocks ORDER BY date, item_code")
    .all()
    .map((row) => ({
      date: row.date,
      itemId: row.item_id,
      itemCode: row.item_code,
      stock: row.stock,
      shipped: row.shipped ?? 0,
    }));
  return {
    updatedAtISO: loadMetaValue(db, "dailyStocksUpdatedAtISO"),
    entries,
  };
}

export function loadImportHeaderOverrides(db) {
  const raw = loadMetaValue(db, "importHeaderOverrides");
  if (!raw) return DEFAULT_IMPORT_HEADER_OVERRIDES;
  try {
    const parsed = JSON.parse(raw);
    return normalizeImportHeaderOverrides(parsed);
  } catch {
    return DEFAULT_IMPORT_HEADER_OVERRIDES;
  }
}

export function saveImportHeaderOverrides(db, payload) {
  const insertMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const normalized = normalizeImportHeaderOverrides(payload);
  insertMeta.run("importHeaderOverrides", JSON.stringify(normalized));
  return normalized;
}

export function savePlanPayload(db, payload) {
  const insertMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const insertMaterial = db.prepare("INSERT INTO materials (id, name, unit) VALUES (?, ?, ?)");
  const insertItem = db.prepare(
    "INSERT INTO items (id, public_id, name, unit, stock, planning_policy, safety_stock, safety_stock_auto_enabled, safety_stock_lookback_days, safety_stock_coefficient, shelf_life_days, production_efficiency, packaging_efficiency, notes, reorder_point, lot_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertRecipe = db.prepare(
    "INSERT INTO item_recipes (item_id, material_id, per_unit, unit) VALUES (?, ?, ?, ?)"
  );
  const insertCalendarDay = db.prepare(
    "INSERT INTO calendar_days (date, is_holiday, work_start, work_end) VALUES (?, ?, ?, ?)"
  );
  const insertBlock = db.prepare(
    "INSERT INTO blocks (id, item_id, lane_row, start_at, end_at, amount, memo, approved, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    db.exec("DELETE FROM blocks");
    db.exec("DELETE FROM item_recipes");
    db.exec("DELETE FROM items");
    db.exec("DELETE FROM materials");
    db.exec("DELETE FROM calendar_days");

    insertMeta.run("version", String(payload.version ?? 1));
    insertMeta.run("weekStartISO", payload.weekStartISO ?? payload.calendarDays?.[0]?.date ?? "");
    insertMeta.run("density", normalizeDensity(payload.density));
    insertMeta.run("updatedAtISO", new Date().toISOString());

    payload.calendarDays?.forEach((day) => {
      insertCalendarDay.run(
        day.date,
        day.isHoliday ? 1 : 0,
        Math.trunc(day.workStartHour ?? 0),
        Math.trunc(day.workEndHour ?? 0)
      );
    });

    payload.materials?.forEach((material) => {
      insertMaterial.run(material.id, material.name, material.unit);
    });

    payload.items?.forEach((item) => {
      insertItem.run(
        item.id,
        item.publicId,
        item.name,
        item.unit,
        item.stock ?? 0,
        item.planningPolicy ?? "make_to_stock",
        item.safetyStock ?? 0,
        item.safetyStockAutoEnabled ? 1 : 0,
        item.safetyStockLookbackDays ?? 7,
        item.safetyStockCoefficient ?? 1,
        item.shelfLifeDays ?? 0,
        item.productionEfficiency ?? 0,
        item.packagingEfficiency ?? 1,
        item.notes ?? "",
        item.reorderPoint ?? 0,
        item.lotSize ?? 0
      );
      item.recipe?.forEach((line) => {
        insertRecipe.run(item.id, line.materialId, line.perUnit ?? 0, line.unit);
      });
    });

    payload.blocks?.forEach((block) => {
      if (!block.startAt || !block.endAt) return;
      insertBlock.run(
        block.id,
        block.itemId,
        Number.isFinite(block.laneRow) ? Math.max(0, Math.trunc(block.laneRow)) : null,
        block.startAt,
        block.endAt,
        block.amount ?? 0,
        block.memo ?? "",
        block.approved ? 1 : 0,
        block.createdBy ?? null,
        block.updatedBy ?? null
      );
    });
  });

  transaction();
}

export function saveDailyStocks(db, entries = []) {
  const insertMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const upsertDailyStock = db.prepare(
    `INSERT INTO daily_stocks (date, item_id, item_code, stock, shipped)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(date, item_id) DO UPDATE SET
       item_code = excluded.item_code,
       stock = excluded.stock,
       shipped = excluded.shipped`
  );
  const updatedAtISO = new Date().toISOString();
  const transaction = db.transaction(() => {
    entries.forEach((entry) => {
      upsertDailyStock.run(
        entry.date,
        entry.itemId,
        entry.itemCode,
        entry.stock ?? 0,
        entry.shipped ?? 0
      );
    });
    insertMeta.run("dailyStocksUpdatedAtISO", updatedAtISO);
  });
  transaction();
  return updatedAtISO;
}
