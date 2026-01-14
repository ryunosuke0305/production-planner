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
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      stock REAL NOT NULL
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
      amount REAL NOT NULL,
      memo TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_start ON blocks(start);
    CREATE INDEX IF NOT EXISTS idx_blocks_item ON blocks(item_id);
    CREATE INDEX IF NOT EXISTS idx_blocks_item_start ON blocks(item_id, start);
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

export function loadPlanPayload(db, { from, to, itemId, itemName } = {}) {
  const metaRows = db.prepare("SELECT key, value FROM meta").all();
  if (!metaRows.length) return null;

  const meta = new Map(metaRows.map((row) => [row.key, row.value]));
  const weekStartISO = meta.get("weekStartISO") ?? "";
  if (!weekStartISO) return null;
  const density = normalizeDensity(meta.get("density"));
  const version = Number(meta.get("version") ?? 1);

  const materials = db
    .prepare("SELECT id, name, unit FROM materials ORDER BY id")
    .all()
    .map((row) => ({ id: row.id, name: row.name, unit: row.unit }));

  const items = db
    .prepare("SELECT id, name, unit, stock FROM items ORDER BY id")
    .all()
    .map((row) => ({ id: row.id, name: row.name, unit: row.unit, stock: row.stock }));

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
  if (from && to) {
    const fromDiff = diffDays(weekStartISO, from);
    const toDiff = diffDays(weekStartISO, to);
    if (fromDiff !== null && toDiff !== null) {
      const perDay = slotsPerDay(density);
      startSlot = fromDiff * perDay;
      endSlot = (toDiff + 1) * perDay - 1;
    }
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
  if (startSlot !== null && endSlot !== null) {
    conditions.push("start <= ? AND (start + len - 1) >= ?");
    params.push(endSlot, startSlot);
  }

  const sql = `SELECT id, item_id, start, len, amount, memo FROM blocks${
    conditions.length ? ` WHERE ${conditions.join(" AND ")}` : ""
  } ORDER BY start, id`;

  const blocks = db.prepare(sql).all(...params).map((row) => ({
    id: row.id,
    itemId: row.item_id,
    start: row.start,
    len: row.len,
    amount: row.amount,
    memo: row.memo,
  }));

  return {
    version: Number.isFinite(version) ? version : 1,
    weekStartISO,
    density,
    materials,
    items: itemsWithRecipes,
    blocks,
  };
}

export function savePlanPayload(db, payload) {
  const insertMeta = db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const insertMaterial = db.prepare("INSERT INTO materials (id, name, unit) VALUES (?, ?, ?)");
  const insertItem = db.prepare("INSERT INTO items (id, name, unit, stock) VALUES (?, ?, ?, ?)");
  const insertRecipe = db.prepare(
    "INSERT INTO item_recipes (item_id, material_id, per_unit, unit) VALUES (?, ?, ?, ?)"
  );
  const insertBlock = db.prepare(
    "INSERT INTO blocks (id, item_id, start, len, amount, memo) VALUES (?, ?, ?, ?, ?, ?)"
  );

  const transaction = db.transaction(() => {
    db.exec("DELETE FROM blocks");
    db.exec("DELETE FROM item_recipes");
    db.exec("DELETE FROM items");
    db.exec("DELETE FROM materials");

    insertMeta.run("version", String(payload.version ?? 1));
    insertMeta.run("weekStartISO", payload.weekStartISO ?? "");
    insertMeta.run("density", normalizeDensity(payload.density));
    insertMeta.run("updatedAtISO", new Date().toISOString());

    payload.materials?.forEach((material) => {
      insertMaterial.run(material.id, material.name, material.unit);
    });

    payload.items?.forEach((item) => {
      insertItem.run(item.id, item.name, item.unit, item.stock ?? 0);
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
        block.amount ?? 0,
        block.memo ?? ""
      );
    });
  });

  transaction();
}
