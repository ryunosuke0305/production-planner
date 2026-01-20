import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const dataDir = path.resolve(process.cwd(), "data");
export const PLAN_DB_PATH = path.join(dataDir, "plan.sqlite");

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
      public_id TEXT,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock REAL NOT NULL,
      planning_policy TEXT NOT NULL DEFAULT 'make_to_stock',
      safety_stock REAL NOT NULL DEFAULT 0,
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
      start INTEGER NOT NULL,
      len INTEGER NOT NULL,
      start_at TEXT,
      end_at TEXT,
      amount REAL NOT NULL,
      memo TEXT NOT NULL,
      approved INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS daily_stocks (
      date TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      stock REAL NOT NULL,
      PRIMARY KEY (date, item_id)
    );
    CREATE TABLE IF NOT EXISTS orders (
      delivery_date TEXT NOT NULL,
      ship_date TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_code TEXT NOT NULL,
      quantity REAL NOT NULL,
      PRIMARY KEY (delivery_date, ship_date, item_id)
    );
    CREATE TABLE IF NOT EXISTS calendar_days (
      date TEXT PRIMARY KEY,
      is_holiday INTEGER NOT NULL DEFAULT 0,
      work_start INTEGER NOT NULL,
      work_end INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_daily_stocks_date ON daily_stocks(date);
    CREATE INDEX IF NOT EXISTS idx_daily_stocks_item ON daily_stocks(item_id);
    CREATE INDEX IF NOT EXISTS idx_orders_delivery_date ON orders(delivery_date);
    CREATE INDEX IF NOT EXISTS idx_orders_item ON orders(item_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_start ON blocks(start);
    CREATE INDEX IF NOT EXISTS idx_blocks_item ON blocks(item_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_item_start ON blocks(item_id, start);
  `);
}

function ensureBlocksApprovedColumn(db) {
  const columns = db.prepare("PRAGMA table_info(blocks)").all();
  const hasApproved = columns.some((column) => column.name === "approved");
  if (!hasApproved) {
    db.exec("ALTER TABLE blocks ADD COLUMN approved INTEGER NOT NULL DEFAULT 0");
  }
}

function ensureBlocksDateColumns(db) {
  const columns = db.prepare("PRAGMA table_info(blocks)").all();
  const hasStartAt = columns.some((column) => column.name === "start_at");
  const hasEndAt = columns.some((column) => column.name === "end_at");
  if (!hasStartAt) {
    db.exec("ALTER TABLE blocks ADD COLUMN start_at TEXT");
  }
  if (!hasEndAt) {
    db.exec("ALTER TABLE blocks ADD COLUMN end_at TEXT");
  }
}

function ensureItemsPlanningColumns(db) {
  const columns = db.prepare("PRAGMA table_info(items)").all();
  const hasPublicId = columns.some((column) => column.name === "public_id");
  const hasPlanningPolicy = columns.some((column) => column.name === "planning_policy");
  const hasSafetyStock = columns.some((column) => column.name === "safety_stock");
  const hasReorderPoint = columns.some((column) => column.name === "reorder_point");
  const hasLotSize = columns.some((column) => column.name === "lot_size");
  if (!hasPublicId) {
    db.exec("ALTER TABLE items ADD COLUMN public_id TEXT");
  }
  if (!hasPlanningPolicy) {
    db.exec("ALTER TABLE items ADD COLUMN planning_policy TEXT NOT NULL DEFAULT 'make_to_stock'");
  }
  if (!hasSafetyStock) {
    db.exec("ALTER TABLE items ADD COLUMN safety_stock REAL NOT NULL DEFAULT 0");
  }
  if (!hasReorderPoint) {
    db.exec("ALTER TABLE items ADD COLUMN reorder_point REAL NOT NULL DEFAULT 0");
  }
  if (!hasLotSize) {
    db.exec("ALTER TABLE items ADD COLUMN lot_size REAL NOT NULL DEFAULT 0");
  }
}

export async function openPlanDatabase() {
  await fs.mkdir(dataDir, { recursive: true });
  const db = new Database(PLAN_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);
  ensureBlocksApprovedColumn(db);
  ensureBlocksDateColumns(db);
  ensureItemsPlanningColumns(db);
  return db;
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
  },
  orders: {
    deliveryDate: "",
    shipDate: "",
    itemCode: "",
    quantity: "",
  },
};

function normalizeImportHeaderOverrides(payload) {
  const toText = (value) => (typeof value === "string" ? value : "");
  return {
    dailyStock: {
      date: toText(payload?.dailyStock?.date),
      itemCode: toText(payload?.dailyStock?.itemCode),
      stock: toText(payload?.dailyStock?.stock),
    },
    orders: {
      deliveryDate: toText(payload?.orders?.deliveryDate),
      shipDate: toText(payload?.orders?.shipDate),
      itemCode: toText(payload?.orders?.itemCode),
      quantity: toText(payload?.orders?.quantity),
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
      "SELECT id, public_id, name, unit, stock, planning_policy, safety_stock, reorder_point, lot_size FROM items ORDER BY id"
    )
    .all()
    .map((row) => ({
      id: row.id,
      publicId: row.public_id ?? undefined,
      name: row.name,
      unit: row.unit,
      stock: row.stock,
      planningPolicy: row.planning_policy ?? "make_to_stock",
      safetyStock: row.safety_stock ?? 0,
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

  let startSlot = null;
  let endSlot = null;
  let fromBoundary = null;
  let toBoundary = null;
  if (from && to) {
    const fromDiff = diffDays(weekStartISO, from);
    const toDiff = diffDays(weekStartISO, to);
    if (fromDiff !== null && toDiff !== null) {
      const perDay = slotsPerDay(density);
      startSlot = fromDiff * perDay;
      endSlot = (toDiff + 1) * perDay - 1;
    }
    fromBoundary = `${from}T00:00:00`;
    toBoundary = `${to}T23:59:59`;
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
  if (fromBoundary && toBoundary) {
    if (startSlot !== null && endSlot !== null) {
      conditions.push(
        "((start_at IS NOT NULL AND end_at IS NOT NULL AND start_at <= ? AND end_at >= ?) OR (start_at IS NULL AND end_at IS NULL AND start <= ? AND (start + len - 1) >= ?))"
      );
      params.push(toBoundary, fromBoundary, endSlot, startSlot);
    } else {
      conditions.push("start_at <= ? AND end_at >= ?");
      params.push(toBoundary, fromBoundary);
    }
  }

  const sql = `SELECT id, item_id, start, len, start_at, end_at, amount, memo, approved FROM blocks${
    conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
  } ORDER BY start, id`;

  const blocks = db.prepare(sql).all(...params).map((row) => ({
    id: row.id,
    itemId: row.item_id,
    start: row.start,
    len: row.len,
    startAt: row.start_at ?? undefined,
    endAt: row.end_at ?? undefined,
    amount: row.amount,
    memo: row.memo,
    approved: Boolean(row.approved),
  }));

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
    .prepare("SELECT date, item_id, item_code, stock FROM daily_stocks ORDER BY date, item_code")
    .all()
    .map((row) => ({
      date: row.date,
      itemId: row.item_id,
      itemCode: row.item_code,
      stock: row.stock,
    }));
  return {
    updatedAtISO: loadMetaValue(db, "dailyStocksUpdatedAtISO"),
    entries,
  };
}

export function loadOrders(db) {
  const entries = db
    .prepare(
      "SELECT delivery_date, ship_date, item_id, item_code, quantity FROM orders ORDER BY delivery_date, ship_date, item_code"
    )
    .all()
    .map((row) => ({
      deliveryDate: row.delivery_date,
      shipDate: row.ship_date,
      itemId: row.item_id,
      itemCode: row.item_code,
      quantity: row.quantity,
    }));
  return {
    updatedAtISO: loadMetaValue(db, "ordersUpdatedAtISO"),
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
    "INSERT INTO items (id, public_id, name, unit, stock, planning_policy, safety_stock, reorder_point, lot_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const insertRecipe = db.prepare(
    "INSERT INTO item_recipes (item_id, material_id, per_unit, unit) VALUES (?, ?, ?, ?)"
  );
  const insertCalendarDay = db.prepare(
    "INSERT INTO calendar_days (date, is_holiday, work_start, work_end) VALUES (?, ?, ?, ?)"
  );
  const insertBlock = db.prepare(
    "INSERT INTO blocks (id, item_id, start, len, start_at, end_at, amount, memo, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
        item.publicId ?? null,
        item.name,
        item.unit,
        item.stock ?? 0,
        item.planningPolicy ?? "make_to_stock",
        item.safetyStock ?? 0,
        item.reorderPoint ?? 0,
        item.lotSize ?? 0
      );
      item.recipe?.forEach((line) => {
        insertRecipe.run(item.id, line.materialId, line.perUnit ?? 0, line.unit);
      });
    });

    payload.blocks?.forEach((block) => {
      insertBlock.run(
        block.id,
        block.itemId,
        Math.trunc(block.start ?? 0),
        Math.max(1, Math.trunc(block.len ?? 1)),
        block.startAt ?? null,
        block.endAt ?? null,
        block.amount ?? 0,
        block.memo ?? "",
        block.approved ? 1 : 0
      );
    });
  });

  transaction();
}

export function saveDailyStocks(db, entries = []) {
  const insertMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const insertDailyStock = db.prepare(
    "INSERT INTO daily_stocks (date, item_id, item_code, stock) VALUES (?, ?, ?, ?)"
  );
  const updatedAtISO = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.exec("DELETE FROM daily_stocks");
    entries.forEach((entry) => {
      insertDailyStock.run(entry.date, entry.itemId, entry.itemCode, entry.stock ?? 0);
    });
    insertMeta.run("dailyStocksUpdatedAtISO", updatedAtISO);
  });
  transaction();
  return updatedAtISO;
}

export function saveOrders(db, entries = []) {
  const insertMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const insertOrder = db.prepare(
    "INSERT INTO orders (delivery_date, ship_date, item_id, item_code, quantity) VALUES (?, ?, ?, ?, ?)"
  );
  const updatedAtISO = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.exec("DELETE FROM orders");
    entries.forEach((entry) => {
      insertOrder.run(
        entry.deliveryDate,
        entry.shipDate,
        entry.itemId,
        entry.itemCode,
        entry.quantity ?? 0
      );
    });
    insertMeta.run("ordersUpdatedAtISO", updatedAtISO);
  });
  transaction();
  return updatedAtISO;
}
