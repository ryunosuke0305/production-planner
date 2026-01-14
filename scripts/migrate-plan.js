import fs from "node:fs/promises";
import path from "node:path";
import { openPlanDatabase, savePlanPayload } from "./plan-db.js";

const planJsonPath = path.resolve(process.cwd(), "data", "plan.json");

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

function normalizeDensity(value) {
  if (value === "hour" || value === "2hour" || value === "day") return value;
  return "hour";
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
      const name = asString(item.name).trim();
      const unit = asString(item.unit).trim();
      if (!id || !name || !unit) return null;
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
        name,
        unit,
        stock: asNumber(item.stock, 0),
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
      return {
        id,
        itemId,
        start: Math.trunc(asNumber(block.start, 0)),
        len: Math.max(1, Math.trunc(asNumber(block.len, 1))),
        amount: asNumber(block.amount, 0),
        memo: asString(block.memo),
      };
    })
    .filter(Boolean);

  return {
    version: Number(record.version) === 1 ? 1 : 1,
    weekStartISO,
    density: normalizeDensity(record.density),
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
