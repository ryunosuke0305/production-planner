import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import * as XLSX from "xlsx";
import { AnimatePresence, motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import manualAdmin from "../data/manual-admin.md?raw";
import manualUser from "../data/manual-user.md?raw";

/**
 * 製造計画ガントチャート（D&D + リサイズ + レシピ編集 + 日区切り強調 + 日次在庫 + JSONエクスポート）
 *
 * 追加機能（直近の要件）
 * - JSONエクスポート：生成AIへAPI連携する前提の入力データ（品目/レシピ/ブロック/週/スロット定義等）を出力
 *
 * 本ファイルは App.tsx で動作することを前提に、
 * JSX の閉じ漏れや JSDoc/JSX のパーサ誤検知を避けるため、
 * 型は TypeScript の interface/type を使用しています。
 */

type Density = "hour" | "2hour" | "day";

const ITEM_UNITS = ["ピース", "ケース", "セット", "kg", "袋", "枚", "個", "箱"] as const;

type ItemUnit = (typeof ITEM_UNITS)[number];

type RecipeUnit = ItemUnit;

const DEFAULT_ITEM_UNIT: ItemUnit = ITEM_UNITS[0];
const DEFAULT_MATERIAL_UNIT: RecipeUnit = "kg";

type PlanningPolicy = "make_to_order" | "make_to_stock";

type Material = {
  id: string;
  name: string;
  unit: RecipeUnit;
};

type RecipeLine = {
  materialId: string;
  perUnit: number;
  unit: RecipeUnit;
};

type Item = {
  id: string;
  publicId?: string;
  name: string;
  unit: ItemUnit;
  planningPolicy: PlanningPolicy;
  safetyStock: number;
  shelfLifeDays: number;
  productionEfficiency: number;
  notes: string;
  recipe: RecipeLine[];
};

type CalendarDay = {
  date: string;
  isHoliday: boolean;
  workStartHour: number;
  workEndHour: number;
};

type Block = {
  id: string;
  itemId: string;
  start: number;
  len: number;
  amount: number;
  memo: string;
  approved: boolean;
  startAt?: string;
  endAt?: string;
};

type ExportPayloadV1 = {
  schemaVersion: "1.2.0";
  meta: {
    exportedAtISO: string;
    timezone: string;
    weekStartISO: string;
    horizonDays: number;
    density: Density;
    slotsPerDay: number;
    slotCount: number;
    weekDates: string[];
    hours: number[];
    slotIndexToLabel: string[];
  };
  items: Array<{
    id: string;
    publicId?: string;
    name: string;
    unit: ItemUnit;
    planningPolicy: PlanningPolicy;
    safetyStock: number;
    shelfLifeDays: number;
    productionEfficiency: number;
    notes: string;
    recipe: Array<{
      materialId: string;
      materialName: string;
      perUnit: number;
      unit: RecipeUnit;
    }>;
  }>;
  materials: Material[];
  blocks: Array<{
    id: string;
    itemId: string;
    start: number;
    len: number;
    startLabel: string;
    endLabel: string;
    amount: number;
    memo: string;
    approved: boolean;
  }>;
  dailyStocks: Array<{
    date: string;
    itemCode: string;
    stock: number;
  }>;
  orders: Array<{
    deliveryDate: string;
    shipDate: string;
    itemCode: string;
    quantity: number;
  }>;
  eodStocks: Array<{
    itemCode: string;
    dates: string[];
    stocks: number[];
  }>;
  constraints: Record<string, unknown>;
};

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt?: string;
};

type ChatAction = {
  type: "create_block" | "update_block" | "delete_block";
  blockId?: string;
  itemId?: string;
  startSlot?: number;
  startLabel?: string;
  len?: number;
  amount?: number;
  memo?: string;
};

type ChatResponsePayload = {
  summary?: string;
  actions?: ChatAction[];
};

type PlanPayload = {
  version: 1;
  weekStartISO: string;
  density: Density;
  calendarDays: CalendarDay[];
  materials: Material[];
  items: Item[];
  blocks: Block[];
};

type DailyStockEntry = {
  date: string;
  itemId: string;
  itemCode: string;
  stock: number;
};

type OrderEntry = {
  deliveryDate: string;
  shipDate: string;
  itemId: string;
  itemCode: string;
  quantity: number;
};

type DailyStocksResponse = {
  updatedAtISO: string | null;
  entries: DailyStockEntry[];
};

type OrdersResponse = {
  updatedAtISO: string | null;
  entries: OrderEntry[];
};

type ImportHeaderOverrides = {
  dailyStock: {
    date: string;
    itemCode: string;
    stock: string;
  };
  orders: {
    deliveryDate: string;
    shipDate: string;
    itemCode: string;
    quantity: string;
  };
};

const DEFAULT_IMPORT_HEADER_OVERRIDES: ImportHeaderOverrides = {
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

const normalizeImportHeaderOverrides = (payload?: Partial<ImportHeaderOverrides> | null): ImportHeaderOverrides => ({
  dailyStock: {
    date: typeof payload?.dailyStock?.date === "string" ? payload.dailyStock.date : "",
    itemCode: typeof payload?.dailyStock?.itemCode === "string" ? payload.dailyStock.itemCode : "",
    stock: typeof payload?.dailyStock?.stock === "string" ? payload.dailyStock.stock : "",
  },
  orders: {
    deliveryDate: typeof payload?.orders?.deliveryDate === "string" ? payload.orders.deliveryDate : "",
    shipDate: typeof payload?.orders?.shipDate === "string" ? payload.orders.shipDate : "",
    itemCode: typeof payload?.orders?.itemCode === "string" ? payload.orders.itemCode : "",
    quantity: typeof payload?.orders?.quantity === "string" ? payload.orders.quantity : "",
  },
});

type InfoTooltipProps = {
  text: string;
};

const InfoTooltip = ({ text }: InfoTooltipProps) => (
  <span className="group relative inline-flex h-4 w-4 items-center justify-center text-slate-500">
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.75a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM9 9.5a.75.75 0 011.5 0v5a.75.75 0 01-1.5 0v-5z"
        clipRule="evenodd"
      />
    </svg>
    <span className="pointer-events-none absolute left-1/2 top-6 z-10 w-56 -translate-x-1/2 rounded bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 shadow transition-opacity group-hover:opacity-100 whitespace-pre-line">
      {text}
    </span>
  </span>
);

const SAMPLE_MATERIALS: Material[] = [
  { id: "MAT-A", name: "原料A", unit: "kg" },
  { id: "MAT-B", name: "原料B", unit: "kg" },
  { id: "MAT-C", name: "原料C", unit: "kg" },
  { id: "MAT-D", name: "原料D", unit: "kg" },
  { id: "MAT-E", name: "原料E", unit: "kg" },
];

const SAMPLE_ITEMS: Item[] = [
  {
    id: "A",
    name: "Item A",
    unit: "ケース",
    planningPolicy: "make_to_stock",
    safetyStock: 20,
    shelfLifeDays: 30,
    productionEfficiency: 40,
    notes: "定番商品のため平準化。",
    recipe: [
      { materialId: "MAT-A", perUnit: 0.25, unit: "kg" },
      { materialId: "MAT-B", perUnit: 0.5, unit: "kg" },
    ],
  },
  {
    id: "B",
    name: "Item B",
    unit: "ケース",
    planningPolicy: "make_to_order",
    safetyStock: 10,
    shelfLifeDays: 7,
    productionEfficiency: 20,
    notes: "受注対応中心。",
    recipe: [
      { materialId: "MAT-A", perUnit: 0.1, unit: "kg" },
      { materialId: "MAT-C", perUnit: 0.2, unit: "kg" },
    ],
  },
  {
    id: "C",
    name: "Item C",
    unit: "kg",
    planningPolicy: "make_to_stock",
    safetyStock: 50,
    shelfLifeDays: 14,
    productionEfficiency: 60,
    notes: "週末の追加生産あり。",
    recipe: [
      { materialId: "MAT-D", perUnit: 0.35, unit: "kg" },
      { materialId: "MAT-E", perUnit: 0.05, unit: "kg" },
    ],
  },
];

const PLANNING_POLICY_LABELS: Record<PlanningPolicy, string> = {
  make_to_order: "受注生産",
  make_to_stock: "見込生産",
};

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatISODateParts(y: number, m: number, d: number): string {
  const yyyy = String(y).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toMD(isoDate: string): string {
  const parts = isoDate.split("-").map((v) => Number(v));
  const m = parts[1];
  const d = parts[2];
  return `${m}/${d}`;
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function toWeekday(isoDate: string): string {
  const date = new Date(isoDate);
  return WEEKDAY_LABELS[date.getDay()] ?? "";
}

const DEFAULT_WORK_START_HOUR = 8;
const DEFAULT_WORK_END_HOUR = 18;
const DAYS_IN_WEEK = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setDate(base.getDate() + delta);
  return d;
}

function diffDays(startISO: string, endISO: string): number {
  const start = new Date(`${startISO}T00:00:00`);
  const end = new Date(`${endISO}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

function buildCalendarDays(start: Date, days: number): CalendarDay[] {
  const out: CalendarDay[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = addDays(start, i);
    const isoDate = toISODate(d);
    const weekday = d.getDay();
    out.push({
      date: isoDate,
      isHoliday: weekday === 0 || weekday === 6,
      workStartHour: DEFAULT_WORK_START_HOUR,
      workEndHour: DEFAULT_WORK_END_HOUR,
    });
  }
  return out;
}

function buildDefaultCalendarDays(start: Date): CalendarDay[] {
  return buildCalendarDays(start, DAYS_IN_WEEK);
}

function calcMaterials(
  item: Item,
  amount: number,
  materialMap: Map<string, Material>
): Array<{ materialId: string; materialName: string; qty: number; unit: RecipeUnit }> {
  return item.recipe.map((r) => ({
    materialId: r.materialId,
    materialName: materialMap.get(r.materialId)?.name ?? "未登録原料",
    qty: r.perUnit * amount,
    unit: r.unit,
  }));
}

function durationLabel(len: number, density: Density): string {
  if (density === "day") return `${len}日`;
  if (density === "2hour") return `${len * 2}時間`;
  return `${len}時間`;
}

function safeNumber(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function uid(prefix = "b"): string {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

const DEFAULT_BLOCKS = (): Block[] => [
  { id: uid("b"), itemId: "A", start: 1, len: 2, amount: 40, memo: "", approved: false },
  { id: uid("b"), itemId: "B", start: 6, len: 2, amount: 30, memo: "段取り注意", approved: false },
];

const getDefaultWeekStart = (): Date => {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMonday);
  monday.setHours(0, 0, 0, 0);
  return monday;
};

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asItemUnit(value: unknown): ItemUnit {
  if (typeof value !== "string") return DEFAULT_ITEM_UNIT;
  if (ITEM_UNITS.includes(value as ItemUnit)) return value as ItemUnit;
  if (value === "cs" || value === "case") return "ケース";
  if (value === "piece" || value === "pcs") return "ピース";
  if (value === "set") return "セット";
  return DEFAULT_ITEM_UNIT;
}

function asPlanningPolicy(value: unknown): PlanningPolicy {
  return value === "make_to_order" ? "make_to_order" : "make_to_stock";
}

function asRecipeUnit(value: unknown): RecipeUnit {
  if (typeof value !== "string") return DEFAULT_MATERIAL_UNIT;
  if (ITEM_UNITS.includes(value as RecipeUnit)) return value as RecipeUnit;
  if (value === "g") return "kg";
  return DEFAULT_MATERIAL_UNIT;
}

function asDensity(value: unknown): Density {
  return value === "day" || value === "2hour" || value === "hour" ? value : "hour";
}

function normalizeHeader(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().replace(/\s+/g, "").toLowerCase();
}

function findHeaderIndex(headers: unknown[], candidates: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const name of candidates) {
    const idx = normalized.indexOf(normalizeHeader(name));
    if (idx >= 0) return idx;
  }
  return -1;
}

function normalizeDateInput(value: unknown): string | null {
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
  const parsed = new Date(asText);
  if (!Number.isNaN(parsed.getTime())) {
    return toISODate(parsed);
  }
  return null;
}

function normalizeNumberInput(value: unknown): number | null {
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

const DAILY_STOCK_HEADERS = {
  date: ["日付", "年月日", "date", "stockdate", "inventorydate"],
  itemCode: ["品目コード", "品目", "itemcode", "item_code", "itemid", "item_id"],
  stock: ["在庫数", "在庫", "stock", "inventory", "qty"],
};

const ORDER_HEADERS = {
  deliveryDate: ["納品日", "納品予定日", "deliverydate", "delivery_date"],
  shipDate: ["出荷日", "出荷予定日", "shipdate", "ship_date", "shipmentdate"],
  itemCode: ["品目コード", "品目", "itemcode", "item_code", "itemid", "item_id"],
  quantity: ["受注数", "受注数量", "数量", "orderqty", "order_qty", "qty"],
};

const ITEM_HEADERS = {
  code: ["品目コード", "コード", "itemcode", "item_code", "itemid", "item_id"],
  name: ["品目名", "品名", "name", "itemname", "item_name"],
  unit: ["単位", "unit"],
  planningPolicy: ["計画方針", "方針", "planningpolicy", "planning_policy", "policy"],
  safetyStock: ["安全在庫", "安全在庫数", "safetystock", "safety_stock"],
  shelfLifeDays: ["賞味期限", "賞味期限日数", "shelflifedays", "shelf_life_days", "expirationdays"],
  productionEfficiency: ["製造効率", "生産効率", "efficiency", "productionefficiency", "production_efficiency"],
  notes: ["備考", "メモ", "notes", "note", "memo", "remark", "remarks"],
};

const MATERIAL_HEADERS = {
  code: ["原料コード", "コード", "materialcode", "material_code", "materialid", "material_id"],
  name: ["原料名", "名称", "name", "material", "materialname", "material_name"],
  unit: ["単位", "unit"],
};

function mergeHeaderCandidates(defaults: string[], override: string): string[] {
  const extras = override
    .split(/[,、\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...extras, ...defaults];
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((cell) => cell === null || cell === undefined || String(cell).trim() === "");
}

function itemCodeKey(item: Item): string {
  return (item.publicId ?? "").trim() || item.id;
}

type ItemImportRow = {
  code: string;
  name: string;
  unit: ItemUnit;
  planningPolicy: PlanningPolicy;
  safetyStock: number;
  shelfLifeDays: number;
  productionEfficiency: number;
  notes: string;
};

type MaterialImportRow = {
  code: string;
  name: string;
  unit: RecipeUnit;
};

function sanitizeItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = asString(record.id).trim();
      const publicId = asString(record.publicId ?? record.public_id ?? record.itemKey ?? record.item_key).trim();
      const name = asString(record.name).trim();
      if (!id || !name) return null;
      const unit = asItemUnit(record.unit);
      const planningPolicy = asPlanningPolicy(record.planningPolicy ?? record.planning_policy);
      const safetyStock = Math.max(0, asNumber(record.safetyStock ?? record.safety_stock));
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
      return {
        id,
        publicId: publicId || undefined,
        name,
        unit,
        planningPolicy,
        safetyStock,
        shelfLifeDays,
        productionEfficiency,
        notes,
        recipe,
      } satisfies Item;
    })
    .filter((item): item is Item => item !== null);
}

function sanitizeMaterials(raw: unknown): Material[] {
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

function sanitizeCalendarDays(raw: unknown): CalendarDay[] {
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

function sanitizeBlocks(raw: unknown): Block[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = asString(record.id).trim();
      const itemId = asString(record.itemId).trim();
      if (!id || !itemId) return null;
      return {
        id,
        itemId,
        start: asNumber(record.start),
        len: Math.max(1, asNumber(record.len, 1)),
        amount: asNumber(record.amount),
        memo: asString(record.memo),
        approved: asBoolean(record.approved, false),
        startAt: asString(record.startAt || record.start_at),
        endAt: asString(record.endAt || record.end_at),
      } satisfies Block;
    })
    .filter((block): block is Block => block !== null);
}

function parsePlanPayload(raw: unknown): PlanPayload | null {
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

function mergeMaterialsFromItems(items: Item[], materials: Material[]): Material[] {
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

function buildCalendarHours(day: CalendarDay, density: Density): number[] {
  if (day.isHoliday) return [];
  if (density === "day") return [day.workStartHour];
  const step = density === "2hour" ? 2 : 1;
  const out: number[] = [];
  for (let h = day.workStartHour; h < day.workEndHour; h += step) {
    out.push(h);
  }
  return out;
}

function buildCalendarSlots(calendarDays: CalendarDay[], density: Density) {
  const rawHoursByDay = calendarDays.map((day) => buildCalendarHours(day, density));
  const slotsPerDay = Math.max(1, ...rawHoursByDay.map((hours) => hours.length));
  const hoursByDay = rawHoursByDay.map((hours) => {
    const padded = [...hours];
    while (padded.length < slotsPerDay) padded.push(null);
    return padded;
  });
  return {
    rawHoursByDay,
    hoursByDay,
    slotsPerDay,
    slotCount: calendarDays.length * slotsPerDay,
  };
}

const BASE_SLOTS_PER_DAY = DEFAULT_WORK_END_HOUR - DEFAULT_WORK_START_HOUR;

function slotsPerDayForDensity(density: Density): number {
  if (density === "day") return 1;
  if (density === "2hour") return Math.max(1, Math.ceil(BASE_SLOTS_PER_DAY / 2));
  return BASE_SLOTS_PER_DAY;
}

function slotUnitsPerSlot(density: Density): number {
  return BASE_SLOTS_PER_DAY / slotsPerDayForDensity(density);
}

function fromAbsoluteSlots(abs: number, density: Density, mode: "floor" | "ceil" | "round"): number {
  const raw = abs / slotUnitsPerSlot(density);
  if (mode === "floor") return Math.floor(raw);
  if (mode === "ceil") return Math.ceil(raw);
  return Math.round(raw);
}

function convertSlotIndex(value: number, from: Density, to: Density, mode: "floor" | "ceil" | "round"): number {
  return fromAbsoluteSlots(value * slotUnitsPerSlot(from), to, mode);
}

function convertSlotLength(value: number, from: Density, to: Density, mode: "ceil" | "round"): number {
  const abs = value * slotUnitsPerSlot(from);
  return Math.max(1, fromAbsoluteSlots(abs, to, mode));
}

function slotLabelFromCalendar(p: {
  density: Density;
  calendarDays: CalendarDay[];
  hoursByDay: Array<Array<number | null>>;
  slotIndex: number;
}): string {
  const perDay = p.hoursByDay[0]?.length ?? 0;
  if (!perDay) return "";
  const dayIdx = Math.floor(p.slotIndex / perDay);
  const hourIdx = p.slotIndex % perDay;
  const day = p.calendarDays[dayIdx];
  const hour = p.hoursByDay[dayIdx]?.[hourIdx];
  if (!day || hour === null || hour === undefined) return "";
  return p.density === "day" ? `${toMD(day.date)}` : `${toMD(day.date)} ${hour}:00`;
}

function buildSlotHeaderLabels(hoursByDay: Array<Array<number | null>>, density: Density): string[] {
  const slotsPerDay = hoursByDay[0]?.length ?? 0;
  return Array.from({ length: slotsPerDay }, (_, slotIdx) => {
    if (density === "day") return "日";
    const hour = hoursByDay.map((day) => day[slotIdx]).find((value) => value !== null && value !== undefined);
    return hour === null || hour === undefined ? "" : `${hour}:00`;
  });
}

function slotToDateTime(
  slotIndex: number,
  calendarDays: CalendarDay[],
  rawHoursByDay: Array<number[]>,
  slotsPerDay: number
): Date | null {
  const dayIdx = Math.floor(slotIndex / slotsPerDay);
  const slotIdx = slotIndex % slotsPerDay;
  const day = calendarDays[dayIdx];
  const hour = rawHoursByDay[dayIdx]?.[slotIdx];
  if (!day || hour === undefined) return null;
  const date = new Date(`${day.date}T${String(hour).padStart(2, "0")}:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function slotBoundaryToDateTime(
  boundaryIndex: number,
  calendarDays: CalendarDay[],
  rawHoursByDay: Array<number[]>,
  slotsPerDay: number
): Date | null {
  const dayIdx = Math.floor(boundaryIndex / slotsPerDay);
  const slotIdx = boundaryIndex % slotsPerDay;
  const day = calendarDays[dayIdx];
  if (!day) return null;
  const dayHours = rawHoursByDay[dayIdx] ?? [];
  if (slotIdx > dayHours.length) return null;
  const hour = slotIdx === dayHours.length ? day.workEndHour : dayHours[slotIdx];
  if (hour === undefined) return null;
  const date = new Date(`${day.date}T${String(hour).padStart(2, "0")}:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function slotIndexFromDateTime(
  value: string,
  calendarDays: CalendarDay[],
  rawHoursByDay: Array<number[]>,
  slotsPerDay: number,
  allowEndBoundary = false
): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const date = toISODate(parsed);
  const hour = parsed.getHours();
  const dayIdx = calendarDays.findIndex((day) => day.date === date);
  if (dayIdx < 0) return null;
  const dayHours = rawHoursByDay[dayIdx] ?? [];
  const slotIdx = dayHours.findIndex((h) => h === hour);
  if (slotIdx >= 0) return dayIdx * slotsPerDay + slotIdx;
  if (allowEndBoundary && hour === calendarDays[dayIdx].workEndHour) {
    return dayIdx * slotsPerDay + dayHours.length;
  }
  return null;
}

function extractJsonPayload(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1).trim();
}

function xToSlot(clientX: number, rect: { left: number; width: number }, slotCount: number): number {
  const x = clientX - rect.left;
  const w = rect.width;
  if (w <= 0) return 0;
  const ratio = x / w;
  const raw = Math.floor(ratio * slotCount);
  return clamp(raw, 0, slotCount - 1);
}

function clampToWorkingSlot(dayIndex: number, slot: number, rawHoursByDay: Array<number[]>): number | null {
  const dayHours = rawHoursByDay[dayIndex] ?? [];
  if (!dayHours.length) return null;
  return clamp(slot, 0, dayHours.length - 1);
}

function endDayIndex(b: Block, slotsPerDay: number): number {
  const endSlot = b.start + b.len - 1;
  return Math.floor(endSlot / slotsPerDay);
}

function downloadTextFile(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "未更新";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未更新";
  return parsed.toLocaleString("ja-JP");
}

function buildExportPayload(p: {
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
  orders: OrderEntry[];
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
    schemaVersion: "1.2.0",
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
      shelfLifeDays: it.shelfLifeDays,
      productionEfficiency: it.productionEfficiency,
      notes: it.notes,
      recipe: it.recipe.map((r) => ({
        materialId: r.materialId,
        materialName: materialMap.get(r.materialId)?.name ?? "未登録原料",
        perUnit: r.perUnit,
        unit: r.unit,
      })),
    })),
    materials: p.materials.map((m) => ({ ...m })),
    blocks: p.blocks.map((b) => ({
      id: b.id,
      itemId: b.itemId,
      start: b.start,
      len: b.len,
      startLabel: slotLabelFromCalendar({
        density: p.density,
        calendarDays: p.calendarDays,
        hoursByDay: p.hoursByDay,
        slotIndex: b.start,
      }),
      endLabel: slotLabelFromCalendar({
        density: p.density,
        calendarDays: p.calendarDays,
        hoursByDay: p.hoursByDay,
        slotIndex: Math.min(p.slotCount - 1, b.start + b.len - 1),
      }),
      amount: b.amount,
      memo: b.memo,
      approved: b.approved,
    })),
    dailyStocks: p.dailyStocks.map((entry) => ({
      date: entry.date,
      itemCode: entry.itemCode,
      stock: entry.stock,
    })),
    orders: p.orders.map((entry) => ({
      deliveryDate: entry.deliveryDate,
      shipDate: entry.shipDate,
      itemCode: entry.itemCode,
      quantity: entry.quantity,
    })),
    eodStocks: p.eodStocks.map((entry) => ({
      itemCode: entry.itemCode,
      dates: entry.dates,
      stocks: entry.stocks,
    })),
    constraints: {},
  };
}

type DragKind = "move" | "resizeL" | "resizeR";

type DragState = {
  kind: DragKind;
  blockId: string;
  originStart: number;
  originLen: number;
  pointerOffset: number;
  laneRect: { left: number; width: number };
  dayIndex: number;
  moved: boolean;
};

export default function ManufacturingPlanGanttApp(): JSX.Element {
  const [navOpen, setNavOpen] = useState(false);
  const [activeView, setActiveView] = useState<"schedule" | "master" | "import" | "manual">("schedule");
  const [masterSection, setMasterSection] = useState<"home" | "items" | "materials">("home");
  const [manualAudience, setManualAudience] = useState<"user" | "admin">("user");
  const [planWeekStart, setPlanWeekStart] = useState<Date>(() => getDefaultWeekStart());
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => getDefaultWeekStart());

  const [planDensity, setPlanDensity] = useState<Density>("hour");
  const [viewDensity, setViewDensity] = useState<Density>("hour");
  const [planCalendarDays, setPlanCalendarDays] = useState<CalendarDay[]>(() =>
    buildDefaultCalendarDays(getDefaultWeekStart())
  );

  // 実運用ではユーザー設定から取得する想定
  const timezone = "Asia/Tokyo";

  const [materialsMaster, setMaterialsMaster] = useState<Material[]>(SAMPLE_MATERIALS);
  const [items, setItems] = useState<Item[]>(SAMPLE_ITEMS);
  const [dailyStocks, setDailyStocks] = useState<DailyStockEntry[]>([]);
  const [orders, setOrders] = useState<OrderEntry[]>([]);
  const [dailyStockUpdatedAt, setDailyStockUpdatedAt] = useState<string | null>(null);
  const [orderUpdatedAt, setOrderUpdatedAt] = useState<string | null>(null);
  const [dailyStockImportNote, setDailyStockImportNote] = useState<string | null>(null);
  const [orderImportNote, setOrderImportNote] = useState<string | null>(null);
  const [itemMasterImportNote, setItemMasterImportNote] = useState<string | null>(null);
  const [materialMasterImportNote, setMaterialMasterImportNote] = useState<string | null>(null);
  const [dailyStockImportError, setDailyStockImportError] = useState<string | null>(null);
  const [orderImportError, setOrderImportError] = useState<string | null>(null);
  const [itemMasterImportError, setItemMasterImportError] = useState<string | null>(null);
  const [materialMasterImportError, setMaterialMasterImportError] = useState<string | null>(null);
  const [dailyStockInputKey, setDailyStockInputKey] = useState(0);
  const [orderInputKey, setOrderInputKey] = useState(0);
  const [itemMasterInputKey, setItemMasterInputKey] = useState(0);
  const [materialMasterInputKey, setMaterialMasterInputKey] = useState(0);
  const [dailyStockHeaderOverrides, setDailyStockHeaderOverrides] = useState(
    DEFAULT_IMPORT_HEADER_OVERRIDES.dailyStock
  );
  const [orderHeaderOverrides, setOrderHeaderOverrides] = useState(DEFAULT_IMPORT_HEADER_OVERRIDES.orders);
  const [importHeaderSaveNote, setImportHeaderSaveNote] = useState<{ daily: string | null; order: string | null }>({
    daily: null,
    order: null,
  });
  const [importHeaderSaveError, setImportHeaderSaveError] = useState<{ daily: string | null; order: string | null }>({
    daily: null,
    order: null,
  });
  const [importHeaderSaveBusy, setImportHeaderSaveBusy] = useState(false);
  const [itemNameDraft, setItemNameDraft] = useState("");
  const [itemPublicIdDraft, setItemPublicIdDraft] = useState("");
  const [itemUnitDraft, setItemUnitDraft] = useState<ItemUnit>(DEFAULT_ITEM_UNIT);
  const [itemPlanningPolicyDraft, setItemPlanningPolicyDraft] = useState<PlanningPolicy>("make_to_stock");
  const [itemSafetyStockDraft, setItemSafetyStockDraft] = useState("0");
  const [itemShelfLifeDaysDraft, setItemShelfLifeDaysDraft] = useState("0");
  const [itemProductionEfficiencyDraft, setItemProductionEfficiencyDraft] = useState("0");
  const [itemNotesDraft, setItemNotesDraft] = useState("");
  const [itemFormError, setItemFormError] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState("");
  const [editingItemPublicId, setEditingItemPublicId] = useState("");
  const [editingItemUnit, setEditingItemUnit] = useState<ItemUnit>(DEFAULT_ITEM_UNIT);
  const [editingItemPlanningPolicy, setEditingItemPlanningPolicy] = useState<PlanningPolicy>("make_to_stock");
  const [editingItemSafetyStock, setEditingItemSafetyStock] = useState("0");
  const [editingItemShelfLifeDays, setEditingItemShelfLifeDays] = useState("0");
  const [editingItemProductionEfficiency, setEditingItemProductionEfficiency] = useState("0");
  const [editingItemNotes, setEditingItemNotes] = useState("");
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "edit">("create");

  const viewStartISO = toISODate(viewWeekStart);
  const planStartISO = planCalendarDays[0]?.date ?? toISODate(planWeekStart);
  const viewStartOffsetDays = useMemo(() => diffDays(planStartISO, viewStartISO), [planStartISO, viewStartISO]);
  const isViewWithinPlanRange =
    viewStartOffsetDays >= 0 && viewStartOffsetDays + DAYS_IN_WEEK <= planCalendarDays.length;

  const viewCalendarDays = useMemo(() => {
    if (!isViewWithinPlanRange) return buildDefaultCalendarDays(viewWeekStart);
    return planCalendarDays.slice(viewStartOffsetDays, viewStartOffsetDays + DAYS_IN_WEEK);
  }, [isViewWithinPlanRange, planCalendarDays, viewStartOffsetDays, viewWeekStart]);

  const viewCalendar = useMemo(
    () => buildCalendarSlots(viewCalendarDays, viewDensity),
    [viewCalendarDays, viewDensity]
  );
  const weekDates = useMemo(() => viewCalendarDays.map((day) => day.date), [viewCalendarDays]);
  const slotsPerDay = viewCalendar.slotsPerDay;
  const slotCount = viewCalendar.slotCount;
  const viewOffsetSlots = viewStartOffsetDays * slotsPerDay;
  const slotHeaderLabels = useMemo(
    () => buildSlotHeaderLabels(viewCalendar.hoursByDay, viewDensity),
    [viewCalendar.hoursByDay, viewDensity]
  );

  const planCalendar = useMemo(
    () => buildCalendarSlots(planCalendarDays, planDensity),
    [planCalendarDays, planDensity]
  );
  const planWeekDates = useMemo(() => planCalendarDays.map((day) => day.date), [planCalendarDays]);
  const planSlotsPerDay = planCalendar.slotsPerDay;
  const planSlotCount = planCalendar.slotCount;
  const planSlotIndexToLabel = useMemo(
    () =>
      Array.from({ length: planSlotCount }, (_, i) =>
        slotLabelFromCalendar({
          density: planDensity,
          calendarDays: planCalendarDays,
          hoursByDay: planCalendar.hoursByDay,
          slotIndex: i,
        })
      ),
    [planCalendar.hoursByDay, planCalendarDays, planDensity, planSlotCount]
  );

  const isPlanWeekView = isViewWithinPlanRange;

  useEffect(() => {
    if (!planCalendarDays.length) return;
    const currentPlanStartISO = planCalendarDays[0].date;
    const currentPlanEndISO = planCalendarDays[planCalendarDays.length - 1].date;
    const viewEndISO = toISODate(addDays(viewWeekStart, DAYS_IN_WEEK - 1));

    if (viewStartISO < currentPlanStartISO) {
      const daysToPrepend = diffDays(viewStartISO, currentPlanStartISO);
      if (daysToPrepend > 0) {
        const newDays = buildCalendarDays(new Date(viewStartISO), daysToPrepend);
        const shiftSlots = daysToPrepend * planSlotsPerDay;
        setPlanCalendarDays((prev) => [...newDays, ...prev]);
        setPlanWeekStart(new Date(viewStartISO));
        if (shiftSlots > 0) {
          setBlocks((prev) => prev.map((b) => ({ ...b, start: b.start + shiftSlots })));
        }
      }
      return;
    }

    if (viewEndISO > currentPlanEndISO) {
      const daysToAppend = diffDays(currentPlanEndISO, viewEndISO);
      if (daysToAppend > 0) {
        const appendStart = addDays(new Date(currentPlanEndISO), 1);
        const newDays = buildCalendarDays(appendStart, daysToAppend);
        setPlanCalendarDays((prev) => [...prev, ...newDays]);
      }
    }
  }, [planCalendarDays, planSlotsPerDay, viewStartISO, viewWeekStart]);

  const geminiModel =
    (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || "gemini-2.5-flash";

  const [blocks, setBlocks] = useState<Block[]>(() => DEFAULT_BLOCKS());

  const [isPlanLoaded, setIsPlanLoaded] = useState(false);

  const [openPlan, setOpenPlan] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [formAmount, setFormAmount] = useState("0");
  const [formMemo, setFormMemo] = useState("");
  const [formApproved, setFormApproved] = useState(false);

  const [openRecipe, setOpenRecipe] = useState(false);
  const [activeRecipeItemId, setActiveRecipeItemId] = useState<string | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeLine[]>([]);
  const [materialNameDraft, setMaterialNameDraft] = useState("");
  const [materialUnitDraft, setMaterialUnitDraft] = useState<RecipeUnit>(DEFAULT_MATERIAL_UNIT);
  const [materialFormError, setMaterialFormError] = useState<string | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [editingMaterialName, setEditingMaterialName] = useState("");
  const [editingMaterialUnit, setEditingMaterialUnit] = useState<RecipeUnit>(DEFAULT_MATERIAL_UNIT);
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [materialModalMode, setMaterialModalMode] = useState<"create" | "edit">("create");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const [constraintsText, setConstraintsText] = useState("");
  const [constraintsDraft, setConstraintsDraft] = useState("");
  const [constraintsBusy, setConstraintsBusy] = useState(false);
  const [constraintsError, setConstraintsError] = useState<string | null>(null);
  const [geminiHorizonDays, setGeminiHorizonDays] = useState(30);
  const [geminiHorizonDaysDraft, setGeminiHorizonDaysDraft] = useState("30");
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null);

  const modalBodyClassName = "px-6 py-4";
  const modalWideClassName = "max-w-2xl";

  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const materialMap = useMemo(() => {
    return new Map(materialsMaster.map((m) => [m.id, m]));
  }, [materialsMaster]);

  const itemMap = useMemo(() => {
    return new Map(items.map((item) => [item.id, item]));
  }, [items]);

  const itemOptions = useMemo(
    () =>
      items.map((item) => {
        const label = item.publicId ? `${item.name} (${item.publicId})` : item.name;
        return {
          value: item.id,
          label,
          description: item.unit,
          keywords: `${item.name} ${item.publicId ?? ""} ${item.id}`,
        };
      }),
    [items]
  );

  const materialOptions = useMemo(
    () =>
      materialsMaster.map((material) => ({
        value: material.id,
        label: `${material.name} (${material.id})`,
        description: material.unit,
        keywords: `${material.name} ${material.id}`,
      })),
    [materialsMaster]
  );

  const itemKeyMap = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => {
      const key = itemCodeKey(item);
      map.set(item.id, item.id);
      map.set(key, item.id);
    });
    return map;
  }, [items]);

  const dailyStockMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    dailyStocks.forEach((entry) => {
      if (!entry.itemId || !entry.date) return;
      if (!map.has(entry.itemId)) {
        map.set(entry.itemId, new Map());
      }
      map.get(entry.itemId)?.set(entry.date, entry.stock);
    });
    return map;
  }, [dailyStocks]);

  const ordersByShipDate = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    orders.forEach((entry) => {
      if (!entry.itemId || !entry.shipDate) return;
      if (!map.has(entry.itemId)) {
        map.set(entry.itemId, new Map());
      }
      const itemMapEntry = map.get(entry.itemId);
      const current = itemMapEntry?.get(entry.shipDate) ?? 0;
      itemMapEntry?.set(entry.shipDate, current + entry.quantity);
    });
    return map;
  }, [orders]);

  const activeBlock = useMemo(() => {
    if (!activeBlockId) return null;
    return blocks.find((b) => b.id === activeBlockId) ?? null;
  }, [activeBlockId, blocks]);

  const [formItemId, setFormItemId] = useState("");

  const activeItem = useMemo(() => {
    if (formItemId) {
      return itemMap.get(formItemId) ?? null;
    }
    if (!activeBlock) return null;
    return itemMap.get(activeBlock.itemId) ?? null;
  }, [activeBlock, formItemId, itemMap]);

  const materials = useMemo(() => {
    if (!activeItem) return [];
    const amount = Math.max(0, safeNumber(formAmount));
    return calcMaterials(activeItem, amount, materialMap);
  }, [activeItem, formAmount, materialMap]);

  const activeManufactureDate = useMemo(() => {
    if (!activeBlock) return null;
    const dateTime = slotToDateTime(
      activeBlock.start,
      planCalendarDays,
      planCalendar.rawHoursByDay,
      planCalendar.slotsPerDay
    );
    return dateTime ? toISODate(dateTime) : null;
  }, [activeBlock, planCalendar.rawHoursByDay, planCalendar.slotsPerDay, planCalendarDays]);

  const activeExpirationDate = useMemo(() => {
    if (!activeItem || !activeManufactureDate) return null;
    const base = new Date(`${activeManufactureDate}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    return toISODate(addDays(base, activeItem.shelfLifeDays ?? 0));
  }, [activeItem, activeManufactureDate]);

  const activeRecipeItem = useMemo(() => {
    if (!activeRecipeItemId) return null;
    return itemMap.get(activeRecipeItemId) ?? null;
  }, [activeRecipeItemId, itemMap]);

  const shiftWeek = (deltaDays: number) => {
    setViewWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(prev.getDate() + deltaDays);
      return d;
    });
  };

  const readFirstSheetRows = async (file: File): Promise<unknown[][]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
    return rows ?? [];
  };

  const runExcelImportWithFeedback = async <TResult, TSummary = void>({
    file,
    parseRows,
    onSuccess,
    buildNote,
    setNote,
    setError,
    setInputKey,
    fallbackErrorMessage,
  }: {
    file: File;
    parseRows: (rows: unknown[][]) => TResult;
    onSuccess: (result: TResult) => Promise<TSummary> | TSummary;
    buildNote: (result: TResult, summary: TSummary) => string;
    setNote: React.Dispatch<React.SetStateAction<string | null>>;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    setInputKey?: React.Dispatch<React.SetStateAction<number>>;
    fallbackErrorMessage: string;
  }) => {
    setError(null);
    setNote(null);
    try {
      const rows = await readFirstSheetRows(file);
      const result = parseRows(rows);
      const summary = await onSuccess(result);
      setNote(buildNote(result, summary));
      if (setInputKey) {
        setInputKey((prev) => prev + 1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackErrorMessage;
      setError(message);
    }
  };

  const parseDailyStockRows = (rows: unknown[][]) => {
    if (!rows.length) {
      throw new Error("シートが空です。");
    }
    const headers = rows[0] ?? [];
    const dateIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(DAILY_STOCK_HEADERS.date, dailyStockHeaderOverrides.date)
    );
    const itemIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(DAILY_STOCK_HEADERS.itemCode, dailyStockHeaderOverrides.itemCode)
    );
    const stockIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(DAILY_STOCK_HEADERS.stock, dailyStockHeaderOverrides.stock)
    );
    if (dateIndex < 0 || itemIndex < 0 || stockIndex < 0) {
      throw new Error("日別在庫の必須列（日付/品目コード/在庫数）が見つかりません。");
    }

    const next: DailyStockEntry[] = [];
    let missingItem = 0;
    let invalidRows = 0;

    rows.slice(1).forEach((row) => {
      if (!row || isEmptyRow(row)) return;
      const date = normalizeDateInput(row[dateIndex]);
      const itemCode = String(row[itemIndex] ?? "").trim();
      const stock = normalizeNumberInput(row[stockIndex]);
      if (!date || !itemCode || stock === null) {
        invalidRows += 1;
        return;
      }
      const itemId = itemKeyMap.get(itemCode);
      if (!itemId) {
        missingItem += 1;
        return;
      }
      next.push({ date, itemId, itemCode, stock });
    });

    return { entries: next, missingItem, invalidRows };
  };

  const parseItemMasterRows = (rows: unknown[][]) => {
    if (!rows.length) {
      throw new Error("シートが空です。");
    }
    const headers = rows[0] ?? [];
    const codeIndex = findHeaderIndex(headers, ITEM_HEADERS.code);
    const nameIndex = findHeaderIndex(headers, ITEM_HEADERS.name);
    if (codeIndex < 0 || nameIndex < 0) {
      throw new Error("品目マスタの必須列（品目コード/品目名）が見つかりません。");
    }
    const unitIndex = findHeaderIndex(headers, ITEM_HEADERS.unit);
    const policyIndex = findHeaderIndex(headers, ITEM_HEADERS.planningPolicy);
    const safetyStockIndex = findHeaderIndex(headers, ITEM_HEADERS.safetyStock);
    const shelfLifeIndex = findHeaderIndex(headers, ITEM_HEADERS.shelfLifeDays);
    const efficiencyIndex = findHeaderIndex(headers, ITEM_HEADERS.productionEfficiency);
    const notesIndex = findHeaderIndex(headers, ITEM_HEADERS.notes);

    const next: ItemImportRow[] = [];
    let invalidRows = 0;
    let duplicateCodes = 0;
    const seen = new Set<string>();

    rows.slice(1).forEach((row) => {
      if (!row || isEmptyRow(row)) return;
      const code = String(row[codeIndex] ?? "").trim();
      const name = String(row[nameIndex] ?? "").trim();
      if (!code || !name) {
        invalidRows += 1;
        return;
      }
      if (seen.has(code)) {
        duplicateCodes += 1;
        return;
      }
      seen.add(code);
      const unit = unitIndex >= 0 ? asItemUnit(row[unitIndex]) : DEFAULT_ITEM_UNIT;
      const planningPolicy = policyIndex >= 0 ? asPlanningPolicy(row[policyIndex]) : "make_to_stock";
      const safetyStock = Math.max(0, normalizeNumberInput(row[safetyStockIndex]) ?? 0);
      const shelfLifeDays = Math.max(0, normalizeNumberInput(row[shelfLifeIndex]) ?? 0);
      const productionEfficiency = Math.max(0, normalizeNumberInput(row[efficiencyIndex]) ?? 0);
      const notes = notesIndex >= 0 ? String(row[notesIndex] ?? "").trim() : "";
      next.push({
        code,
        name,
        unit,
        planningPolicy,
        safetyStock,
        shelfLifeDays,
        productionEfficiency,
        notes,
      });
    });

    return { entries: next, invalidRows, duplicateCodes };
  };

  const parseOrderRows = (rows: unknown[][]) => {
    if (!rows.length) {
      throw new Error("シートが空です。");
    }
    const headers = rows[0] ?? [];
    const deliveryIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(ORDER_HEADERS.deliveryDate, orderHeaderOverrides.deliveryDate)
    );
    const shipIndex = findHeaderIndex(headers, mergeHeaderCandidates(ORDER_HEADERS.shipDate, orderHeaderOverrides.shipDate));
    const itemIndex = findHeaderIndex(headers, mergeHeaderCandidates(ORDER_HEADERS.itemCode, orderHeaderOverrides.itemCode));
    const qtyIndex = findHeaderIndex(headers, mergeHeaderCandidates(ORDER_HEADERS.quantity, orderHeaderOverrides.quantity));
    if (deliveryIndex < 0 || shipIndex < 0 || itemIndex < 0 || qtyIndex < 0) {
      throw new Error("受注一覧の必須列（納品日/出荷日/品目コード/受注数）が見つかりません。");
    }

    const next: OrderEntry[] = [];
    let missingItem = 0;
    let invalidRows = 0;

    rows.slice(1).forEach((row) => {
      if (!row || isEmptyRow(row)) return;
      const deliveryDate = normalizeDateInput(row[deliveryIndex]);
      const shipDate = normalizeDateInput(row[shipIndex]);
      const itemCode = String(row[itemIndex] ?? "").trim();
      const quantity = normalizeNumberInput(row[qtyIndex]);
      if (!deliveryDate || !shipDate || !itemCode || quantity === null) {
        invalidRows += 1;
        return;
      }
      const itemId = itemKeyMap.get(itemCode);
      if (!itemId) {
        missingItem += 1;
        return;
      }
      next.push({ deliveryDate, shipDate, itemId, itemCode, quantity });
    });

    return { entries: next, missingItem, invalidRows };
  };

  const parseMaterialMasterRows = (rows: unknown[][]) => {
    if (!rows.length) {
      throw new Error("シートが空です。");
    }
    const headers = rows[0] ?? [];
    const codeIndex = findHeaderIndex(headers, MATERIAL_HEADERS.code);
    const nameIndex = findHeaderIndex(headers, MATERIAL_HEADERS.name);
    if (codeIndex < 0 || nameIndex < 0) {
      throw new Error("原料マスタの必須列（原料コード/原料名）が見つかりません。");
    }
    const unitIndex = findHeaderIndex(headers, MATERIAL_HEADERS.unit);

    const next: MaterialImportRow[] = [];
    let invalidRows = 0;
    let duplicateCodes = 0;
    const seen = new Set<string>();

    rows.slice(1).forEach((row) => {
      if (!row || isEmptyRow(row)) return;
      const code = String(row[codeIndex] ?? "").trim();
      const name = String(row[nameIndex] ?? "").trim();
      if (!code || !name) {
        invalidRows += 1;
        return;
      }
      if (seen.has(code)) {
        duplicateCodes += 1;
        return;
      }
      seen.add(code);
      const unit = unitIndex >= 0 ? asRecipeUnit(row[unitIndex]) : DEFAULT_MATERIAL_UNIT;
      next.push({ code, name, unit });
    });

    return { entries: next, invalidRows, duplicateCodes };
  };

  const saveDailyStocksToServer = async (entries: DailyStockEntry[]) => {
    const response = await fetch("/api/daily-stocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) {
      throw new Error("日別在庫の保存に失敗しました。");
    }
    const payload = (await response.json()) as Partial<DailyStocksResponse>;
    const updatedAtISO = typeof payload.updatedAtISO === "string" ? payload.updatedAtISO : null;
    setDailyStockUpdatedAt(updatedAtISO);
  };

  const saveOrdersToServer = async (entries: OrderEntry[]) => {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) {
      throw new Error("受注一覧の保存に失敗しました。");
    }
    const payload = (await response.json()) as Partial<OrdersResponse>;
    const updatedAtISO = typeof payload.updatedAtISO === "string" ? payload.updatedAtISO : null;
    setOrderUpdatedAt(updatedAtISO);
  };

  const saveImportHeaderOverrides = async (target: "daily" | "order") => {
    setImportHeaderSaveBusy(true);
    setImportHeaderSaveNote((prev) => ({ ...prev, [target]: null }));
    setImportHeaderSaveError((prev) => ({ ...prev, [target]: null }));
    try {
      const response = await fetch("/api/import-headers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyStock: dailyStockHeaderOverrides,
          orders: orderHeaderOverrides,
        } satisfies ImportHeaderOverrides),
      });
      if (!response.ok) {
        throw new Error("ヘッダー指定の保存に失敗しました。");
      }
      setImportHeaderSaveNote((prev) => ({ ...prev, [target]: "ヘッダー指定を保存しました。" }));
    } catch {
      setImportHeaderSaveError((prev) => ({ ...prev, [target]: "ヘッダー指定の保存に失敗しました。" }));
    } finally {
      setImportHeaderSaveBusy(false);
    }
  };

  const handleDailyStockImport = async (file: File) => {
    await runExcelImportWithFeedback({
      file,
      parseRows: parseDailyStockRows,
      onSuccess: async (result) => {
        await saveDailyStocksToServer(result.entries);
        setDailyStocks(result.entries);
      },
      buildNote: (result) =>
        `日別在庫を${result.entries.length}件取り込みました。` +
        (result.missingItem ? ` (品目未登録:${result.missingItem}件)` : "") +
        (result.invalidRows ? ` (無効行:${result.invalidRows}件)` : ""),
      setNote: setDailyStockImportNote,
      setError: setDailyStockImportError,
      setInputKey: setDailyStockInputKey,
      fallbackErrorMessage: "日別在庫の取り込みに失敗しました。",
    });
  };

  const handleOrderImport = async (file: File) => {
    await runExcelImportWithFeedback({
      file,
      parseRows: parseOrderRows,
      onSuccess: async (result) => {
        await saveOrdersToServer(result.entries);
        setOrders(result.entries);
      },
      buildNote: (result) =>
        `受注一覧を${result.entries.length}件取り込みました。` +
        (result.missingItem ? ` (品目未登録:${result.missingItem}件)` : "") +
        (result.invalidRows ? ` (無効行:${result.invalidRows}件)` : ""),
      setNote: setOrderImportNote,
      setError: setOrderImportError,
      setInputKey: setOrderInputKey,
      fallbackErrorMessage: "受注一覧の取り込みに失敗しました。",
    });
  };

  const handleItemMasterImport = async (file: File) => {
    await runExcelImportWithFeedback({
      file,
      parseRows: parseItemMasterRows,
      onSuccess: (result) => {
        const existingByCode = new Map(items.map((item) => [itemCodeKey(item), item]));
        const indexById = new Map(items.map((item, idx) => [item.id, idx]));
        const nextItems = [...items];
        let created = 0;
        let updated = 0;
        result.entries.forEach((row) => {
          const existing = existingByCode.get(row.code);
          if (existing) {
            const updatedItem: Item = {
              ...existing,
              publicId: row.code,
              name: row.name,
              unit: row.unit,
              planningPolicy: row.planningPolicy,
              safetyStock: row.safetyStock,
              shelfLifeDays: row.shelfLifeDays,
              productionEfficiency: row.productionEfficiency,
              notes: row.notes,
            };
            const idx = indexById.get(existing.id);
            if (typeof idx === "number") {
              nextItems[idx] = updatedItem;
            } else {
              nextItems.push(updatedItem);
            }
            updated += 1;
          } else {
            nextItems.push({
              id: uid("i"),
              publicId: row.code,
              name: row.name,
              unit: row.unit,
              planningPolicy: row.planningPolicy,
              safetyStock: row.safetyStock,
              shelfLifeDays: row.shelfLifeDays,
              productionEfficiency: row.productionEfficiency,
              notes: row.notes,
              recipe: [],
            });
            created += 1;
          }
        });
        setItems(nextItems);
        return { created, updated };
      },
      buildNote: (result, summary) =>
        `品目マスタを${summary.created + summary.updated}件取り込みました。` +
        ` (新規:${summary.created}件/更新:${summary.updated}件)` +
        (result.duplicateCodes ? ` (重複コード:${result.duplicateCodes}件)` : "") +
        (result.invalidRows ? ` (無効行:${result.invalidRows}件)` : ""),
      setNote: setItemMasterImportNote,
      setError: setItemMasterImportError,
      setInputKey: setItemMasterInputKey,
      fallbackErrorMessage: "品目マスタの取り込みに失敗しました。",
    });
  };

  const handleMaterialMasterImport = async (file: File) => {
    await runExcelImportWithFeedback({
      file,
      parseRows: parseMaterialMasterRows,
      onSuccess: (result) => {
        const existingByCode = new Map(materialsMaster.map((material) => [material.id, material]));
        const indexById = new Map(materialsMaster.map((material, idx) => [material.id, idx]));
        const nextMaterials = [...materialsMaster];
        let created = 0;
        let updated = 0;
        result.entries.forEach((row) => {
          const existing = existingByCode.get(row.code);
          if (existing) {
            const updatedMaterial: Material = {
              ...existing,
              id: existing.id,
              name: row.name,
              unit: row.unit,
            };
            const idx = indexById.get(existing.id);
            if (typeof idx === "number") {
              nextMaterials[idx] = updatedMaterial;
            } else {
              nextMaterials.push(updatedMaterial);
            }
            updated += 1;
          } else {
            nextMaterials.push({
              id: row.code,
              name: row.name,
              unit: row.unit,
            });
            created += 1;
          }
        });
        setMaterialsMaster(nextMaterials);
        return { created, updated };
      },
      buildNote: (result, summary) =>
        `原料マスタを${summary.created + summary.updated}件取り込みました。` +
        ` (新規:${summary.created}件/更新:${summary.updated}件)` +
        (result.duplicateCodes ? ` (重複コード:${result.duplicateCodes}件)` : "") +
        (result.invalidRows ? ` (無効行:${result.invalidRows}件)` : ""),
      setNote: setMaterialMasterImportNote,
      setError: setMaterialMasterImportError,
      setInputKey: setMaterialMasterInputKey,
      fallbackErrorMessage: "原料マスタの取り込みに失敗しました。",
    });
  };

  useEffect(() => {
    setBlocks((prev) =>
      prev
        .map((b) => {
          const start = clamp(b.start, 0, planSlotCount - 1);
          const len = clamp(b.len, 1, planSlotCount - start);
          return { ...b, start, len };
        })
        .filter((b) => b.len >= 1)
    );
  }, [planSlotCount]);

  useEffect(() => {
    let cancelled = false;
    const loadPlan = async () => {
      try {
        const response = await fetch("/api/plan");
        if (!response.ok || response.status === 204) return;
        const raw = (await response.json()) as unknown;
        const payload = parsePlanPayload(raw);
        if (!payload || cancelled) return;

        const parsedWeekStart = new Date(payload.weekStartISO);
        const effectiveWeekStart = Number.isNaN(parsedWeekStart.getTime()) ? getDefaultWeekStart() : parsedWeekStart;
        const currentWeekStart = getDefaultWeekStart();
        effectiveWeekStart.setHours(0, 0, 0, 0);
        const nextCalendarDays = payload.calendarDays.length
          ? payload.calendarDays
          : buildDefaultCalendarDays(effectiveWeekStart);
        const normalizedWeekStart = new Date(nextCalendarDays[0]?.date ?? payload.weekStartISO);
        if (!Number.isNaN(normalizedWeekStart.getTime())) {
          normalizedWeekStart.setHours(0, 0, 0, 0);
          setPlanWeekStart(normalizedWeekStart);
          setViewWeekStart(currentWeekStart);
        }
        setPlanDensity(payload.density);
        setViewDensity(payload.density);
        setPlanCalendarDays(nextCalendarDays);
        const loadedItems = payload.items.length ? payload.items : SAMPLE_ITEMS;
        const loadedMaterials = payload.materials.length ? payload.materials : SAMPLE_MATERIALS;
        const calendarSlots = buildCalendarSlots(nextCalendarDays, payload.density);
        setMaterialsMaster(mergeMaterialsFromItems(loadedItems, loadedMaterials));
        setItems(loadedItems);
        const mappedBlocks = payload.blocks.map((block) => {
          const startAtIndex = block.startAt
            ? slotIndexFromDateTime(
                block.startAt,
                nextCalendarDays,
                calendarSlots.rawHoursByDay,
                calendarSlots.slotsPerDay
              )
            : null;
          const endAtIndex = block.endAt
            ? slotIndexFromDateTime(
                block.endAt,
                nextCalendarDays,
                calendarSlots.rawHoursByDay,
                calendarSlots.slotsPerDay,
                true
              )
            : null;
          const start = startAtIndex ?? block.start ?? 0;
          const len =
            startAtIndex !== null && endAtIndex !== null
              ? Math.max(1, endAtIndex - startAtIndex)
              : Math.max(1, block.len ?? 1);
          return {
            ...block,
            start,
            len,
          };
        });
        setBlocks(mappedBlocks.length ? mappedBlocks : DEFAULT_BLOCKS());
      } catch {
        // 読み込み失敗時は既定値を維持
      } finally {
        if (!cancelled) setIsPlanLoaded(true);
      }
    };
    void loadPlan();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadImportedData = async () => {
      try {
        const [dailyResponse, orderResponse] = await Promise.all([fetch("/api/daily-stocks"), fetch("/api/orders")]);
        if (!dailyResponse.ok || !orderResponse.ok) return;
        const dailyPayload = (await dailyResponse.json()) as Partial<DailyStocksResponse>;
        const orderPayload = (await orderResponse.json()) as Partial<OrdersResponse>;
        if (cancelled) return;
        setDailyStocks(Array.isArray(dailyPayload.entries) ? dailyPayload.entries : []);
        setOrders(Array.isArray(orderPayload.entries) ? orderPayload.entries : []);
        setDailyStockUpdatedAt(typeof dailyPayload.updatedAtISO === "string" ? dailyPayload.updatedAtISO : null);
        setOrderUpdatedAt(typeof orderPayload.updatedAtISO === "string" ? orderPayload.updatedAtISO : null);
      } catch {
        // 読み込み失敗時は既定値を維持
      }
    };
    void loadImportedData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadImportHeaders = async () => {
      try {
        const response = await fetch("/api/import-headers");
        if (!response.ok) return;
        const payload = (await response.json()) as Partial<ImportHeaderOverrides>;
        if (cancelled) return;
        const normalized = normalizeImportHeaderOverrides(payload);
        setDailyStockHeaderOverrides(normalized.dailyStock);
        setOrderHeaderOverrides(normalized.orders);
      } catch {
        // 読み込み失敗時は既定値を維持
      }
    };
    void loadImportHeaders();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isPlanLoaded) return;
    const controller = new AbortController();
    const savePlan = async () => {
      try {
        const blocksWithDates = blocks.map((block) => {
          const startAt = slotToDateTime(
            block.start,
            planCalendarDays,
            planCalendar.rawHoursByDay,
            planCalendar.slotsPerDay
          );
          const endAt = slotBoundaryToDateTime(
            block.start + block.len,
            planCalendarDays,
            planCalendar.rawHoursByDay,
            planCalendar.slotsPerDay
          );
          return {
            ...block,
            startAt: startAt?.toISOString(),
            endAt: endAt?.toISOString(),
          };
        });
        await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: 1,
            weekStartISO: planCalendarDays[0]?.date ?? toISODate(planWeekStart),
            density: planDensity,
            calendarDays: planCalendarDays,
            materials: materialsMaster,
            items,
            blocks: blocksWithDates,
          } satisfies PlanPayload),
          signal: controller.signal,
        });
      } catch {
        // 保存失敗時は再度の変更で再送される
      }
    };
    void savePlan();
    return () => {
      controller.abort();
    };
  }, [
    blocks,
    isPlanLoaded,
    items,
    materialsMaster,
    planCalendar,
    planCalendarDays,
    planDensity,
    planWeekStart,
  ]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, chatBusy]);

  useEffect(() => {
    let cancelled = false;
    const loadChatHistory = async () => {
      try {
        const response = await fetch("/api/chat");
        if (!response.ok) return;
        const data = (await response.json()) as { messages?: ChatMessage[] };
        if (!cancelled && Array.isArray(data.messages)) {
          setChatMessages(data.messages);
        }
      } catch {
        // 読み込み失敗時は未読み込みのままにする
      }
    };
    void loadChatHistory();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadConstraints = async () => {
      try {
        const response = await fetch("/api/constraints");
        if (!response.ok || response.status === 204) return;
        const data = (await response.json()) as { text?: string };
        if (!cancelled && typeof data?.text === "string") {
          setConstraintsText(data.text);
        }
      } catch {
        // 読み込み失敗時は未設定のままにする
      }
    };
    void loadConstraints();
    return () => {
      cancelled = true;
    };
  }, []);

  const appendChatHistory = async (messages: ChatMessage[]) => {
    if (!messages.length) return;
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
    } catch {
      // 保存失敗時は次回の更新で再試行
    }
  };

  const buildPlanContext = () => {
    const horizonDays = Math.max(1, Math.floor(geminiHorizonDays));
    const horizonEndISO = toISODate(addDays(new Date(), horizonDays));
    const horizonEndIndex = planCalendarDays.findIndex((day) => day.date > horizonEndISO);
    const horizonCalendarDays =
      horizonEndIndex === -1 ? planCalendarDays : planCalendarDays.slice(0, horizonEndIndex);
    const horizonWeekDates = horizonCalendarDays.map((day) => day.date);
    const horizonSlotCount = horizonCalendarDays.length * planSlotsPerDay;
    const horizonSlotIndexToLabel = planSlotIndexToLabel.slice(0, horizonSlotCount);
    const blockSummaries = blocks.map((b) => ({
      id: b.id,
      itemId: (itemMap.get(b.itemId)?.publicId ?? "").trim() || b.itemId,
      startSlot: b.start,
      startLabel: slotLabelFromCalendar({
        density: planDensity,
        calendarDays: planCalendarDays,
        hoursByDay: planCalendar.hoursByDay,
        slotIndex: b.start,
      }),
      len: b.len,
      amount: b.amount,
      memo: b.memo,
      approved: b.approved,
      startAt: slotToDateTime(
        b.start,
        planCalendarDays,
        planCalendar.rawHoursByDay,
        planCalendar.slotsPerDay
      )?.toISOString(),
      endAt: slotBoundaryToDateTime(
        b.start + b.len,
        planCalendarDays,
        planCalendar.rawHoursByDay,
        planCalendar.slotsPerDay
      )?.toISOString(),
    }));
    const filteredBlocks = blockSummaries.filter((block) => {
      if (!block.startAt) return false;
      return block.startAt.slice(0, 10) <= horizonEndISO;
    });
    const filteredDailyStocks = dailyStocks.filter((entry) => entry.date <= horizonEndISO);
    const filteredOrders = orders.filter(
      (entry) => entry.deliveryDate <= horizonEndISO || entry.shipDate <= horizonEndISO
    );
    const eodStocks = items.map((item) => ({
      itemId: (item.publicId ?? "").trim() || item.id,
      dates: horizonWeekDates,
      stocks: horizonWeekDates.map((_, idx) => eodStockByItem[item.id]?.[idx] ?? 0),
    }));

    return JSON.stringify(
      {
        weekStartISO: horizonWeekDates[0] ?? planWeekDates[0],
        density: planDensity,
        slotsPerDay: planSlotsPerDay,
        slotCount: horizonSlotCount,
        slotIndexToLabel: horizonSlotIndexToLabel,
        calendarDays: horizonCalendarDays,
        materials: materialsMaster,
        items: items.map((item) => ({
          itemId: (item.publicId ?? "").trim() || item.id,
          unit: item.unit,
          planningPolicy: item.planningPolicy,
          safetyStock: item.safetyStock,
          shelfLifeDays: item.shelfLifeDays,
          productionEfficiency: item.productionEfficiency,
          notes: item.notes,
          recipe: item.recipe.map((line) => ({
            ...line,
            materialName: materialMap.get(line.materialId)?.name ?? "未登録原料",
          })),
        })),
        dailyStocks: filteredDailyStocks.map((entry) => ({
          date: entry.date,
          itemCode: entry.itemCode,
          stock: entry.stock,
        })),
        orders: filteredOrders.map((entry) => ({
          deliveryDate: entry.deliveryDate,
          shipDate: entry.shipDate,
          itemCode: entry.itemCode,
          quantity: entry.quantity,
        })),
        eodStocks,
        blocks: filteredBlocks,
      },
      null,
      2
    );
  };

  const resolveItemId = (action: ChatAction) => {
    if (!action.itemId) return null;
    const trimmed = action.itemId.trim();
    return itemKeyMap.get(trimmed) ?? null;
  };

  const resolveSlotIndex = (action: ChatAction) => {
    if (Number.isFinite(action.startSlot)) {
      return clamp(Number(action.startSlot), 0, planSlotCount - 1);
    }
    if (action.startLabel) {
      const idx = planSlotIndexToLabel.findIndex((label) => label === action.startLabel);
      if (idx >= 0) return idx;
    }
    return null;
  };

  const resolveBlockId = (action: ChatAction, currentBlocks: Block[]) => {
    if (action.blockId && currentBlocks.some((b) => b.id === action.blockId)) return action.blockId;
    const itemId = resolveItemId(action);
    const start = resolveSlotIndex(action);
    if (!itemId || start === null) return null;
    const found = currentBlocks.find((b) => b.itemId === itemId && b.start === start);
    return found?.id ?? null;
  };

  const applyChatActions = (actions: ChatAction[]) => {
    if (!actions.length) return;
    setBlocks((prev) => {
      let next = [...prev];
      actions.forEach((action) => {
        if (action.type === "create_block") {
          const itemId = resolveItemId(action);
          const start = resolveSlotIndex(action);
          if (!itemId || start === null) return;
          const len = clamp(action.len ?? 1, 1, planSlotCount - start);
          const candidate: Block = {
            id: uid("b"),
            itemId,
            start,
            len,
            amount: Math.max(0, action.amount ?? 0),
            memo: action.memo ?? "",
            approved: false,
          };
          next = [...next, resolveOverlap(candidate, next)];
        }

        if (action.type === "update_block") {
          const targetId = resolveBlockId(action, next);
          if (!targetId) return;
          const target = next.find((b) => b.id === targetId);
          if (!target || target.approved) return;
          next = next.map((b) => {
            if (b.id !== targetId) return b;
            const itemId = resolveItemId(action) ?? b.itemId;
            const start = resolveSlotIndex(action) ?? b.start;
            const len = clamp(action.len ?? b.len, 1, planSlotCount - start);
            return resolveOverlap(
              {
                ...b,
                itemId,
                start,
                len,
                amount: action.amount ?? b.amount,
                memo: action.memo ?? b.memo,
                approved: false,
              },
              next
            );
          });
        }

        if (action.type === "delete_block") {
          const targetId = resolveBlockId(action, next);
          if (!targetId) return;
          const target = next.find((b) => b.id === targetId);
          if (!target || target.approved) return;
          next = next.filter((b) => b.id !== targetId);
        }
      });
      return next;
    });
  };

  const sendChatMessage = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatBusy) return;
    const userMessageId = uid("chat");
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatBusy(true);
    setChatError(null);

    const systemInstruction = [
      "あなたは製造計画のアシスタントです。",
      "返答は必ずJSONのみで、説明文やコードブロックは含めません。",
      "次のスキーマに従ってください。",
      "{",
      '  "summary": "ユーザーに伝える短い要約",',
      '  "actions": [',
      "    {",
      '      "type": "create_block | update_block | delete_block",',
      '      "blockId": "既存ブロックコード（更新/削除時に推奨）",',
      '      "itemId": "品目コード（マスタで設定したコード）",',
      '      "startSlot": "開始スロット番号（0始まり）",',
      '      "startLabel": "開始ラベル（startSlotが不明な場合）",',
      '      "len": "スロット長",',
      '      "amount": "生産数量",',
      '      "memo": "メモ"',
      "    }",
      "  ]",
      "}",
      "startSlotかstartLabelのどちらかは必ず指定してください。",
      "既存ブロックの更新/削除ではblockIdを優先してください。",
      "承認済みのブロックは編集・削除できません。",
      "ユーザーが「空いてるところ」「空き枠」「この日までに」などの曖昧な指示を出した場合は、blocksの重複を避けつつ、条件に合う最も早いスロットを選んでstartSlotを必ず指定してください。",
    ].join("\n");

    const planContext = buildPlanContext();
    const constraintsNote = constraintsText.trim() ? `\n\nユーザー制約条件:\n${constraintsText.trim()}` : "";
    const messageWithContext = `${trimmed}${constraintsNote}\n\n現在の計画データ(JSON):\n${planContext}`;
    const chatHistoryCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentChatMessages = chatMessages.filter((message) => {
      if (!message.createdAt) return false;
      const timestamp = Date.parse(message.createdAt);
      if (Number.isNaN(timestamp)) return false;
      return timestamp >= chatHistoryCutoff;
    });

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: geminiModel,
          systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
          contents: [
            ...recentChatMessages.map((msg) => ({
              role: msg.role === "assistant" ? "model" : "user",
              parts: [{ text: msg.content }],
            })),
            { role: "user", parts: [{ text: messageWithContext }] },
          ],
        }),
      });

      if (response.status === 409) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
        const message =
          errorPayload?.message ??
          "現在別の指示を処理しています。処理結果を確認後に再度実行してください。";
        setChatError(message);
        const assistantMessage: ChatMessage = {
          id: uid("chat"),
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
        void appendChatHistory([userMessage, assistantMessage]);
        return;
      }

      if (response.status === 401) {
        const errorBody = await response.text();
        console.error("Gemini API認証エラー:", {
          status: response.status,
          body: errorBody,
        });
        const message = "サーバー側にGemini APIキーが設定されていません。data/.envにGEMINI_API_KEYを設定してください。";
        setChatError(message);
        const assistantMessage: ChatMessage = {
          id: uid("chat"),
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
        void appendChatHistory([userMessage, assistantMessage]);
        return;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Gemini APIエラー:", {
          status: response.status,
          body: errorBody,
        });
        throw new Error(`Gemini APIエラー: ${response.status}`);
      }
      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const jsonText = extractJsonPayload(rawText) ?? rawText;
      let parsed: ChatResponsePayload | null = null;
      try {
        parsed = JSON.parse(jsonText);
      } catch (error) {
        parsed = null;
      }

      if (parsed?.actions) {
        applyChatActions(parsed.actions);
      }

      const assistantContent =
        parsed?.summary ??
        (parsed?.actions?.length ? `更新アクションを${parsed.actions.length}件適用しました。` : rawText);

      const assistantMessage: ChatMessage = {
        id: uid("chat"),
        role: "assistant",
        content: assistantContent.trim() || "更新しました。",
        createdAt: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
      void appendChatHistory([userMessage, assistantMessage]);
    } catch (error) {
      console.error("Gemini API呼び出しエラー:", error);
      const message = error instanceof Error ? error.message : "Gemini API呼び出しに失敗しました。";
      setChatError(message);
      const assistantMessage: ChatMessage = {
        id: uid("chat"),
        role: "assistant",
        content: "API呼び出しでエラーが発生しました。",
        createdAt: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
      void appendChatHistory([userMessage, assistantMessage]);
    } finally {
      setChatBusy(false);
    }
  };

  const saveConstraints = async () => {
    if (constraintsBusy) return;
    setConstraintsBusy(true);
    setConstraintsError(null);
    try {
      const nextHorizonDays = Math.max(1, Math.floor(safeNumber(geminiHorizonDaysDraft) || 30));
      const response = await fetch("/api/constraints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: constraintsDraft }),
      });
      if (!response.ok) {
        throw new Error("保存に失敗しました。");
      }
      setConstraintsText(constraintsDraft);
      setGeminiHorizonDays(nextHorizonDays);
      setGeminiHorizonDaysDraft(String(nextHorizonDays));
      setConstraintsOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存に失敗しました。";
      setConstraintsError(message);
    } finally {
      setConstraintsBusy(false);
    }
  };

  const openPlanEdit = (block: Block, options?: { isNew?: boolean }) => {
    setActiveBlockId(block.id);
    setFormAmount(String(block.amount ?? 0));
    setFormMemo(block.memo ?? "");
    setFormItemId(block.itemId);
    setFormApproved(block.approved);
    setPendingBlockId(options?.isNew ? block.id : null);
    setOpenPlan(true);
  };

  const onPlanSave = () => {
    if (!activeBlockId) return;
    const amount = Math.max(0, safeNumber(formAmount));
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === activeBlockId
          ? {
              ...b,
              itemId: formItemId || b.itemId,
              amount,
              memo: formMemo,
              approved: formApproved,
            }
          : b
      )
    );
    setPendingBlockId(null);
    setOpenPlan(false);
  };

  const onPlanDelete = () => {
    if (!activeBlockId) return;
    setBlocks((prev) => prev.filter((b) => b.id !== activeBlockId));
    setPendingBlockId(null);
    setActiveBlockId(null);
    setOpenPlan(false);
  };

  const toggleBlockApproval = () => {
    if (!activeBlockId) return;
    setFormApproved((prev) => !prev);
  };

  const handlePlanOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setOpenPlan(true);
      return;
    }
    if (pendingBlockId) {
      setBlocks((prev) => prev.filter((b) => b.id !== pendingBlockId));
      setPendingBlockId(null);
      setActiveBlockId(null);
    }
    setOpenPlan(false);
  };

  const createBlockAt = (dayIndex: number, slot: number) => {
    if (!isPlanWeekView) return;
    const workingSlot = clampToWorkingSlot(dayIndex, slot, viewCalendar.rawHoursByDay);
    if (workingSlot === null) return;
    const absoluteSlot = (viewStartOffsetDays + dayIndex) * slotsPerDay + workingSlot;
    const planSlot = clamp(convertSlotIndex(absoluteSlot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const fallbackItemId = items[0]?.id ?? "";
    const b: Block = {
      id: uid("b"),
      itemId: fallbackItemId,
      start: planSlot,
      len: 1,
      amount: 0,
      memo: "",
      approved: false,
    };
    setBlocks((prev) => [...prev, b]);
    openPlanEdit(b, { isNew: true });
  };

  const resolveOverlap = (candidate: Block, allBlocks: Block[]): Block => {
    const sameLane = allBlocks.filter((x) => x.id !== candidate.id).sort((a, b) => a.start - b.start);

    let start = candidate.start;
    let len = candidate.len;

    for (const b of sameLane) {
      const a1 = start;
      const a2 = start + len;
      const b1 = b.start;
      const b2 = b.start + b.len;
      const overlap = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
      if (overlap > 0) start = clamp(b2, 0, planSlotCount - 1);
    }

    start = clamp(start, 0, planSlotCount - 1);
    len = clamp(len, 1, planSlotCount - start);

    return { ...candidate, start, len };
  };

  const beginPointer = (p: { kind: DragKind; blockId: string; dayIndex: number; clientX: number }) => {
    if (!isPlanWeekView) return;
    const laneEl = laneRefs.current[String(p.dayIndex)];
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const block = blocks.find((b) => b.id === p.blockId);
    if (!block) return;
    const slot = xToSlot(p.clientX, { left: rect.left, width: rect.width }, slotsPerDay);
    const workingSlot = clampToWorkingSlot(p.dayIndex, slot, viewCalendar.rawHoursByDay);
    if (workingSlot === null) return;
    const absoluteSlot = (viewStartOffsetDays + p.dayIndex) * slotsPerDay + workingSlot;
    const planSlot = clamp(convertSlotIndex(absoluteSlot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const pointerOffset = clamp(planSlot - block.start, 0, Math.max(0, block.len - 1));

    suppressClickRef.current = true;

    dragStateRef.current = {
      kind: p.kind,
      blockId: p.blockId,
      originStart: block.start,
      originLen: block.len,
      pointerOffset,
      laneRect: { left: rect.left, width: rect.width },
      dayIndex: p.dayIndex,
      moved: false,
    };
  };

  const resolveLaneAtPointer = (clientY: number) => {
    for (let i = 0; i < weekDates.length; i += 1) {
      const laneEl = laneRefs.current[String(i)];
      if (!laneEl) continue;
      const rect = laneEl.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return { dayIndex: i, rect };
      }
    }
    return null;
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = dragStateRef.current;
    if (!s) return;

    let activeDayIndex = s.dayIndex;
    let laneRect = s.laneRect;
    if (s.kind === "move") {
      const lane = resolveLaneAtPointer(e.clientY);
      if (lane) {
        activeDayIndex = lane.dayIndex;
        laneRect = lane.rect;
        s.dayIndex = lane.dayIndex;
        s.laneRect = lane.rect;
      }
    }

    const slot = xToSlot(e.clientX, laneRect, slotsPerDay);
    const workingSlot = clampToWorkingSlot(activeDayIndex, slot, viewCalendar.rawHoursByDay);
    if (workingSlot === null) return;
    const absoluteSlot = (viewStartOffsetDays + activeDayIndex) * slotsPerDay + workingSlot;
    const planSlot = clamp(convertSlotIndex(absoluteSlot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const planSlotEnd = clamp(convertSlotIndex(absoluteSlot + 1, viewDensity, planDensity, "ceil"), 1, planSlotCount);
    const planDayIndex = viewStartOffsetDays + activeDayIndex;
    const daySlots = planCalendar.rawHoursByDay[planDayIndex]?.length ?? 0;
    if (!daySlots) return;
    const dayStart = planDayIndex * planSlotsPerDay;
    const dayEnd = dayStart + daySlots;
    s.moved = true;

    setBlocks((prev) => {
      const next = prev.map((b) => {
        if (b.id !== s.blockId) return b;

        if (s.kind === "move") {
          const maxStart = Math.max(dayStart, dayEnd - s.originLen);
          const start = clamp(planSlot - s.pointerOffset, dayStart, maxStart);
          const len = clamp(s.originLen, 1, planSlotCount - start);
          return resolveOverlap({ ...b, start, len }, prev);
        }

        if (s.kind === "resizeL") {
          const end = s.originStart + s.originLen;
          const newStart = clamp(planSlot, dayStart, end - 1);
          const newLen = clamp(end - newStart, 1, planSlotCount - newStart);
          return resolveOverlap({ ...b, start: newStart, len: newLen }, prev);
        }

        const newEnd = clamp(planSlotEnd, b.start + 1, dayEnd);
        const newLen = clamp(newEnd - b.start, 1, planSlotCount - b.start);
        return resolveOverlap({ ...b, len: newLen }, prev);
      });
      return next;
    });
  };

  const endPointer = () => {
    dragStateRef.current = null;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 120);
  };

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
    };
  }, [
    planCalendar.rawHoursByDay,
    planDensity,
    planSlotCount,
    planSlotsPerDay,
    slotsPerDay,
    viewCalendar,
    viewDensity,
    viewStartOffsetDays,
  ]);

  const openRecipeEdit = (itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    setActiveRecipeItemId(itemId);
    setRecipeDraft(it.recipe.map((r) => ({ ...r })));
    setOpenRecipe(true);
  };

  const onRecipeSave = () => {
    if (!activeRecipeItemId) return;
    const validMaterialIds = new Set(materialsMaster.map((m) => m.id));
    setItems((prev) =>
      prev.map((it) =>
        it.id === activeRecipeItemId
          ? {
              ...it,
              recipe: recipeDraft
                .map((r) => ({
                  materialId: (r.materialId ?? "").trim(),
                  perUnit: Number.isFinite(Number(r.perUnit)) ? Number(r.perUnit) : 0,
                  unit: asRecipeUnit(r.unit),
                }))
                .filter((r) => r.materialId.length > 0 && validMaterialIds.has(r.materialId)),
            }
          : it
      )
    );
    setOpenRecipe(false);
  };

  const resetItemDrafts = () => {
    setItemNameDraft("");
    setItemPublicIdDraft("");
    setItemUnitDraft(DEFAULT_ITEM_UNIT);
    setItemPlanningPolicyDraft("make_to_stock");
    setItemSafetyStockDraft("0");
    setItemShelfLifeDaysDraft("0");
    setItemProductionEfficiencyDraft("0");
    setItemNotesDraft("");
  };

  const openCreateItemModal = () => {
    setItemModalMode("create");
    resetItemDrafts();
    setItemFormError(null);
    setIsItemModalOpen(true);
  };

  const onCreateItem = () => {
    const name = itemNameDraft.trim();
    const publicId = itemPublicIdDraft.trim();
    if (!name) {
      setItemFormError("品目名を入力してください。");
      return false;
    }
    if (items.some((it) => it.name === name)) {
      setItemFormError("同じ品目名がすでに登録されています。");
      return false;
    }
    if (publicId && items.some((it) => it.id === publicId || (it.publicId ?? "").trim() === publicId)) {
      setItemFormError("同じ品目コードがすでに登録されています。");
      return false;
    }
    const safetyStock = Math.max(0, safeNumber(itemSafetyStockDraft));
    const shelfLifeDays = Math.max(0, safeNumber(itemShelfLifeDaysDraft));
    const productionEfficiency = Math.max(0, safeNumber(itemProductionEfficiencyDraft));
    const newItem: Item = {
      id: uid("item"),
      publicId: publicId || undefined,
      name,
      unit: itemUnitDraft,
      planningPolicy: itemPlanningPolicyDraft,
      safetyStock,
      shelfLifeDays,
      productionEfficiency,
      notes: itemNotesDraft.trim(),
      recipe: [],
    };
    setItems((prev) => [...prev, newItem]);
    resetItemDrafts();
    setItemFormError(null);
    return true;
  };

  const onStartEditItem = (item: Item) => {
    setEditingItemId(item.id);
    setEditingItemName(item.name);
    setEditingItemPublicId(item.publicId ?? "");
    setEditingItemUnit(item.unit);
    setEditingItemPlanningPolicy(item.planningPolicy ?? "make_to_stock");
    setEditingItemSafetyStock(String(item.safetyStock ?? 0));
    setEditingItemShelfLifeDays(String(item.shelfLifeDays ?? 0));
    setEditingItemProductionEfficiency(String(item.productionEfficiency ?? 0));
    setEditingItemNotes(item.notes ?? "");
    setItemFormError(null);
  };

  const onCancelEditItem = () => {
    setEditingItemId(null);
    setEditingItemName("");
    setEditingItemPublicId("");
    setEditingItemUnit(DEFAULT_ITEM_UNIT);
    setEditingItemPlanningPolicy("make_to_stock");
    setEditingItemSafetyStock("0");
    setEditingItemShelfLifeDays("0");
    setEditingItemProductionEfficiency("0");
    setEditingItemNotes("");
    setItemFormError(null);
  };

  const onSaveEditItem = () => {
    if (!editingItemId) return;
    const nextName = editingItemName.trim();
    const nextPublicId = editingItemPublicId.trim();
    if (!nextName) {
      setItemFormError("品目名を入力してください。");
      return false;
    }
    if (items.some((it) => it.name === nextName && it.id !== editingItemId)) {
      setItemFormError("同じ品目名がすでに登録されています。");
      return false;
    }
    if (
      nextPublicId &&
      items.some(
        (it) => it.id !== editingItemId && (it.id === nextPublicId || (it.publicId ?? "").trim() === nextPublicId)
      )
    ) {
      setItemFormError("同じ品目コードがすでに登録されています。");
      return false;
    }
    const nextSafetyStock = Math.max(0, safeNumber(editingItemSafetyStock));
    const nextShelfLifeDays = Math.max(0, safeNumber(editingItemShelfLifeDays));
    const nextProductionEfficiency = Math.max(0, safeNumber(editingItemProductionEfficiency));
    const nextNotes = editingItemNotes.trim();
    setItems((prev) =>
      prev.map((it) =>
        it.id === editingItemId
          ? {
              ...it,
              publicId: nextPublicId || undefined,
              name: nextName,
              unit: editingItemUnit,
              planningPolicy: editingItemPlanningPolicy,
              safetyStock: nextSafetyStock,
              shelfLifeDays: nextShelfLifeDays,
              productionEfficiency: nextProductionEfficiency,
              notes: nextNotes,
            }
          : it
      )
    );
    setItemFormError(null);
    onCancelEditItem();
    return true;
  };

  const onDeleteItem = (itemId: string) => {
    const target = items.find((it) => it.id === itemId);
    if (!target) return false;
    const confirmed = window.confirm(`${target.name} を削除しますか？`);
    if (!confirmed) return false;
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    setBlocks((prev) => prev.filter((b) => b.itemId !== itemId));
    if (activeBlockId) {
      const hasActive = blocks.some((b) => b.id === activeBlockId && b.itemId === itemId);
      if (hasActive) {
        setActiveBlockId(null);
        setOpenPlan(false);
      }
    }
    if (activeRecipeItemId === itemId) {
      setActiveRecipeItemId(null);
      setOpenRecipe(false);
    }
    if (editingItemId === itemId) {
      onCancelEditItem();
    }
    return true;
  };

  const resetMaterialDrafts = () => {
    setMaterialNameDraft("");
    setMaterialUnitDraft(DEFAULT_MATERIAL_UNIT);
  };

  const openCreateMaterialModal = () => {
    setMaterialModalMode("create");
    resetMaterialDrafts();
    setMaterialFormError(null);
    setIsMaterialModalOpen(true);
  };

  const onCreateMaterial = () => {
    const name = materialNameDraft.trim();
    if (!name) {
      setMaterialFormError("原料名を入力してください。");
      return false;
    }
    if (materialsMaster.some((m) => m.name === name)) {
      setMaterialFormError("同じ原料名がすでに登録されています。");
      return false;
    }
    const newMaterial: Material = {
      id: uid("mat"),
      name,
      unit: materialUnitDraft,
    };
    setMaterialsMaster((prev) => [...prev, newMaterial]);
    resetMaterialDrafts();
    setMaterialFormError(null);
    return true;
  };

  const onStartEditMaterial = (material: Material) => {
    setEditingMaterialId(material.id);
    setEditingMaterialName(material.name);
    setEditingMaterialUnit(material.unit);
    setMaterialFormError(null);
  };

  const onCancelEditMaterial = () => {
    setEditingMaterialId(null);
    setEditingMaterialName("");
    setEditingMaterialUnit(DEFAULT_MATERIAL_UNIT);
    setMaterialFormError(null);
  };

  const onSaveEditMaterial = () => {
    if (!editingMaterialId) return;
    const nextName = editingMaterialName.trim();
    if (!nextName) {
      setMaterialFormError("原料名を入力してください。");
      return false;
    }
    if (materialsMaster.some((m) => m.name === nextName && m.id !== editingMaterialId)) {
      setMaterialFormError("同じ原料名がすでに登録されています。");
      return false;
    }
    setMaterialsMaster((prev) =>
      prev.map((m) =>
        m.id === editingMaterialId
          ? {
              ...m,
              name: nextName,
              unit: editingMaterialUnit,
            }
          : m
      )
    );
    setMaterialFormError(null);
    onCancelEditMaterial();
    return true;
  };

  const onDeleteMaterial = (materialId: string) => {
    const target = materialsMaster.find((m) => m.id === materialId);
    if (!target) return false;
    const confirmed = window.confirm(`${target.name} を削除しますか？`);
    if (!confirmed) return false;
    setMaterialsMaster((prev) => prev.filter((m) => m.id !== materialId));
    setItems((prev) =>
      prev.map((item) => ({
        ...item,
        recipe: item.recipe.filter((line) => line.materialId !== materialId),
      }))
    );
    setRecipeDraft((prev) => prev.filter((line) => line.materialId !== materialId));
    if (editingMaterialId === materialId) {
      onCancelEditMaterial();
    }
    return true;
  };

  const openEditItemModal = (item: Item) => {
    setItemModalMode("edit");
    onStartEditItem(item);
    setIsItemModalOpen(true);
  };

  const handleItemModalOpenChange = (open: boolean) => {
    setIsItemModalOpen(open);
    if (!open) {
      setItemFormError(null);
      if (itemModalMode === "edit") {
        onCancelEditItem();
      } else {
        resetItemDrafts();
      }
    }
  };

  const openEditMaterialModal = (material: Material) => {
    setMaterialModalMode("edit");
    onStartEditMaterial(material);
    setIsMaterialModalOpen(true);
  };

  const handleMaterialModalOpenChange = (open: boolean) => {
    setIsMaterialModalOpen(open);
    if (!open) {
      setMaterialFormError(null);
      if (materialModalMode === "edit") {
        onCancelEditMaterial();
      } else {
        resetMaterialDrafts();
      }
    }
  };

  const eodStockByItem = useMemo(() => {
    const blocksForEod = isPlanWeekView ? blocks : [];
    const out: Record<string, number[]> = {};
    const weekDatesForEod = weekDates;

    for (const it of items) {
      const addByDay = new Array(7).fill(0);
      for (const b of blocksForEod) {
        if (b.itemId !== it.id) continue;
        const dayIndex = endDayIndex(b, planSlotsPerDay) - viewStartOffsetDays;
        if (dayIndex < 0 || dayIndex >= 7) continue;
        addByDay[dayIndex] += Number.isFinite(b.amount) ? b.amount : 0;
      }
      const eod = new Array(7).fill(0);
      let cur = 0;
      for (let d = 0; d < 7; d += 1) {
        const date = weekDatesForEod[d];
        const override = dailyStockMap.get(it.id)?.get(date ?? "");
        if (override !== undefined) {
          cur = override;
        }
        const shipped = ordersByShipDate.get(it.id)?.get(date ?? "") ?? 0;
        cur += addByDay[d] - shipped;
        eod[d] = cur;
      }
      out[it.id] = eod;
    }

    return out;
  }, [blocks, dailyStockMap, isPlanWeekView, items, ordersByShipDate, planSlotsPerDay, viewStartOffsetDays, weekDates]);

  const eodSummaryByDay = useMemo(() => {
    const blocksForEod = isPlanWeekView ? blocks : [];
    const itemsByDay: Record<number, Set<string>> = {};

    for (const b of blocksForEod) {
      const d = endDayIndex(b, planSlotsPerDay) - viewStartOffsetDays;
      if (d < 0 || d >= 7) continue;
      if (!itemsByDay[d]) itemsByDay[d] = new Set();
      itemsByDay[d].add(b.itemId);
    }

    return weekDates.map((_, dayIdx) => {
      const ids = Array.from(itemsByDay[dayIdx] ?? []);
      return ids.map((id) => {
        const item = itemMap.get(id);
        return {
          itemId: id,
          name: item?.name ?? id,
          unit: item?.unit ?? "",
          stock: eodStockByItem[id]?.[dayIdx] ?? 0,
        };
      });
    });
  }, [blocks, eodStockByItem, isPlanWeekView, itemMap, planSlotsPerDay, viewStartOffsetDays, weekDates]);

  // JSONエクスポート
  const exportPlanAsJson = () => {
    const payload = buildExportPayload({
      weekStart: planWeekStart,
      timezone,
      density: planDensity,
      calendarDays: planCalendarDays,
      hoursByDay: planCalendar.hoursByDay,
      slotsPerDay: planSlotsPerDay,
      slotCount: planSlotCount,
      materials: materialsMaster,
      items,
      blocks,
      dailyStocks,
      orders,
      eodStocks: items.map((item) => ({
        itemId: item.id,
        itemCode: (item.publicId ?? "").trim() || item.id,
        dates: planWeekDates,
        stocks: eodStockByItem[item.id] ?? [],
      })),
    });

    const json = JSON.stringify(payload, null, 2);
    const filename = `manufacturing_plan_${payload.meta.weekStartISO}_${planDensity}.json`;
    downloadTextFile(filename, json, "application/json");
  };

  // 表示上の列幅
  const colW = viewDensity === "day" ? 120 : 72;

  // 目盛線（時間グリッド）
  const slotGridBg = `repeating-linear-gradient(to right, transparent 0, transparent ${
    colW - 1
  }px, rgba(148, 163, 184, 0.4) ${colW - 1}px, rgba(148, 163, 184, 0.4) ${colW}px)`;

  const isItemEditMode = itemModalMode === "edit";
  const isMaterialEditMode = materialModalMode === "edit";
  const itemEfficiencyUnit = isItemEditMode ? editingItemUnit : itemUnitDraft;

  const handleItemModalSave = () => {
    const didSave = isItemEditMode ? onSaveEditItem() : onCreateItem();
    if (didSave) {
      setIsItemModalOpen(false);
    }
  };

  const handleMaterialModalSave = () => {
    const didSave = isMaterialEditMode ? onSaveEditMaterial() : onCreateMaterial();
    if (didSave) {
      setIsMaterialModalOpen(false);
    }
  };

  const scheduleHeader = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">製造計画</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={exportPlanAsJson}>
          JSONエクスポート
        </Button>
        <Button variant="outline" onClick={() => shiftWeek(-7)}>
          前の週
        </Button>
        <Button variant="outline" onClick={() => shiftWeek(7)}>
          次の週
        </Button>

        <div className="w-44">
          <Select value={viewDensity} onValueChange={(v) => setViewDensity(v as Density)}>
            <SelectTrigger>
              <SelectValue placeholder="表示密度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">1時間</SelectItem>
              <SelectItem value="2hour">2時間</SelectItem>
              <SelectItem value="day">日単位</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  const scheduleCard = (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="flex min-h-[56px] items-center pb-2">
        <CardTitle className="text-base font-medium">
          週表示：{weekDates[0] ? toMD(weekDates[0]) : ""} 〜{" "}
          {weekDates.length ? toMD(weekDates[weekDates.length - 1]) : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <div
            className="min-w-[1100px] text-slate-900"
            style={{
              display: "grid",
              gridTemplateColumns: `220px repeat(${slotsPerDay}, ${colW}px) 220px`,
            }}
          >
            {/* ヘッダ（時間） */}
            <div className="sticky left-0 top-0 z-50 bg-white border-b border-r p-3 font-medium">日付</div>
            {slotHeaderLabels.map((label, idx) => (
              <div
                key={`hour-${label || "blank"}-${idx}`}
                className="sticky top-0 z-20 bg-white border-b border-r p-2 text-center text-xs text-muted-foreground"
              >
                {label || (viewDensity === "day" ? "日" : "")}
              </div>
            ))}
            <div className="sticky top-0 z-30 bg-white border-b p-3 text-center font-medium">在庫（EOD）</div>

            {/* 行（日付） */}
            {weekDates.map((date, dayIdx) => {
              const calendarDay = viewCalendarDays[dayIdx];
              const eodList = eodSummaryByDay[dayIdx] ?? [];
              const laneBlocks = (isPlanWeekView ? blocks : [])
                .map((b) => {
                  const rawViewStart = convertSlotIndex(b.start, planDensity, viewDensity, "floor");
                  const viewStart = rawViewStart - viewOffsetSlots;
                  const viewLen = convertSlotLength(b.len, planDensity, viewDensity, "ceil");
                  const viewDayIdx = Math.floor(viewStart / slotsPerDay);
                  if (viewDayIdx < 0 || viewDayIdx >= DAYS_IN_WEEK) return null;
                  const viewStartInDay = viewStart - viewDayIdx * slotsPerDay;
                  const maxLen = Math.max(1, slotsPerDay - viewStartInDay);
                  return {
                    block: b,
                    viewDayIdx,
                    viewStartInDay,
                    viewLen: clamp(viewLen, 1, maxLen),
                  };
                })
                .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
                .filter((entry) => entry.viewDayIdx === dayIdx)
                .sort((a, b) => a.viewStartInDay - b.viewStartInDay);

              return (
                <React.Fragment key={date}>
                  <div className="sticky left-0 z-40 bg-white border-b border-r p-3">
                    <div className="text-sm font-semibold">{toMD(date)}</div>
                    <div className="text-xs text-muted-foreground">({toWeekday(date)})</div>
                    {calendarDay?.isHoliday ? (
                      <div className="mt-1 text-[10px] font-medium text-rose-500">休日</div>
                    ) : null}
                  </div>

                  <div
                    className="relative border-b overflow-hidden"
                    style={{ gridColumn: `span ${slotsPerDay}`, height: 72 }}
                    ref={(el) => {
                      laneRefs.current[String(dayIdx)] = el;
                    }}
                    onClick={(e) => {
                      if (suppressClickRef.current) return;
                      if (e.defaultPrevented) return;

                      const rect = e.currentTarget.getBoundingClientRect();
                      const slot = xToSlot(e.clientX, { left: rect.left, width: rect.width }, slotsPerDay);
                      createBlockAt(dayIdx, slot);
                    }}
                  >
                    <div className="absolute inset-0" style={{ backgroundImage: slotGridBg, opacity: 0.8 }} />

                    {laneBlocks.map(({ block, viewStartInDay, viewLen }) => {
                      const left = viewStartInDay * colW;
                      const width = viewLen * colW;
                      const isActive = block.id === activeBlockId;
                      const item = itemMap.get(block.itemId);
                      const toneClass = block.approved
                        ? isActive
                          ? " border-emerald-500 bg-emerald-200"
                          : " border-emerald-200 bg-emerald-100 hover:bg-emerald-200"
                        : isActive
                          ? " border-sky-400 bg-sky-200"
                          : " border-sky-200 bg-sky-100 hover:bg-sky-200";

                      return (
                        <motion.div
                          key={block.id}
                          className={"absolute top-[8px] h-[52px] rounded-xl border shadow-sm touch-none" + toneClass}
                          style={{ left, width }}
                          whileTap={{ scale: 0.99 }}
                          onClick={(ev) => {
                            if (suppressClickRef.current) return;
                            ev.preventDefault();
                            ev.stopPropagation();
                            openPlanEdit(block);
                          }}
                        >
                          <div
                            className="absolute left-0 top-0 z-30 h-full w-2 cursor-ew-resize rounded-l-xl touch-none"
                            onPointerDown={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              beginPointer({ kind: "resizeL", blockId: block.id, dayIndex: dayIdx, clientX: ev.clientX });
                            }}
                            title="幅調整（左）"
                          />

                          <div
                            className="absolute right-0 top-0 z-30 h-full w-2 cursor-ew-resize rounded-r-xl touch-none"
                            onPointerDown={(ev) => {
                              ev.preventDefault();
                              ev.stopPropagation();
                              beginPointer({ kind: "resizeR", blockId: block.id, dayIndex: dayIdx, clientX: ev.clientX });
                            }}
                            title="幅調整（右）"
                          />

                          <div
                            className="absolute inset-0 z-10 cursor-grab select-none rounded-xl p-2 touch-none"
                            onPointerDown={(ev) => {
                              const r = ev.currentTarget.getBoundingClientRect();
                              const x = ev.clientX - r.left;
                              if (x <= 8 || x >= r.width - 8) return;
                              ev.preventDefault();
                              ev.stopPropagation();
                              beginPointer({ kind: "move", blockId: block.id, dayIndex: dayIdx, clientX: ev.clientX });
                            }}
                          >
                            <div className="flex h-full flex-col justify-between">
                              <div className="flex items-center justify-between text-[11px] text-slate-700">
                                <span>{item?.name ?? "未設定"}</span>
                                <span>{durationLabel(block.len, planDensity)}</span>
                              </div>
                              <div className="text-sm font-semibold">
                                +{block.amount}
                                <span className="ml-1 text-xs text-slate-600">{item?.unit ?? ""}</span>
                              </div>
                              <div className="truncate text-[11px] text-slate-600">{block.memo || " "}</div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  <div className="border-b p-3 text-xs">
                    {eodList.length ? (
                      <div className="space-y-1">
                        {eodList.map((entry) => (
                          <div key={`${entry.itemId}-${dayIdx}`} className="flex items-center justify-between">
                            <div className="font-medium text-slate-700">{entry.name}</div>
                            <div className="text-slate-600">
                              {entry.stock}
                              {entry.unit}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">生産なし</div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const scheduleView = (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-4">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{scheduleHeader}</div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">{scheduleCard}</div>

      <div className="w-full shrink-0 lg:col-start-2 lg:row-start-2">
        <Card className="flex flex-col rounded-2xl shadow-sm lg:h-[calc(100vh-12rem)]">
          <CardHeader className="flex min-h-[56px] items-center pb-2">
            <div className="flex w-full items-center justify-between gap-2">
              <CardTitle className="text-base font-medium">Gemini チャット</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setConstraintsDraft(constraintsText);
                  setGeminiHorizonDaysDraft(String(geminiHorizonDays));
                  setConstraintsError(null);
                  setConstraintsOpen(true);
                }}
              >
                条件設定
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {chatError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {chatError}
              </div>
            ) : null}
            <div ref={chatScrollRef} className="flex-1 space-y-2 overflow-y-auto rounded-md border bg-background p-2">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={
                      "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                      (msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")
                    }
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatBusy ? (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">送信中...</div>
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void sendChatMessage();
                  }
                }}
                placeholder="例：品目コード A を 9/12 10:00から2時間、40ケース 追加して"
                rows={3}
              />
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Ctrl+Enter / Cmd+Enter で送信</div>
                <Button onClick={() => void sendChatMessage()} disabled={chatBusy}>
                  送信
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Dialog open={constraintsOpen} onOpenChange={setConstraintsOpen}>
          <DialogContent className={modalWideClassName}>
            <DialogHeader>
              <DialogTitle>条件設定</DialogTitle>
            </DialogHeader>
            <div className={modalBodyClassName}>
              <div className="space-y-3">
                <div className="text-sm text-muted-foreground">
                  Geminiへ送る追加の制約条件を入力してください。
                </div>
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-medium">計画データの対象日数</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={geminiHorizonDaysDraft}
                      onChange={(e) => setGeminiHorizonDaysDraft(e.target.value)}
                      className="w-28"
                    />
                    <span className="text-sm text-muted-foreground">日先まで</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    今日を起点に、指定日数分の計画データのみをGeminiへ渡します。
                  </div>
                </div>
                <Textarea
                  value={constraintsDraft}
                  onChange={(e) => setConstraintsDraft(e.target.value)}
                  className="min-h-[220px]"
                placeholder="例：設備Xは午前のみ稼働、残業は不可、最小ロットは50ケース など"
                />
                {constraintsError ? (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    {constraintsError}
                  </div>
                ) : null}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConstraintsOpen(false)} disabled={constraintsBusy}>
                キャンセル
              </Button>
              <Button onClick={() => void saveConstraints()} disabled={constraintsBusy}>
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {/* 計画編集モーダル */}
      <Dialog open={openPlan} onOpenChange={handlePlanOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {activeItem ? activeItem.name : ""}
              {activeBlock ? (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {slotLabelFromCalendar({
                    density: planDensity,
                    calendarDays: planCalendarDays,
                    hoursByDay: planCalendar.hoursByDay,
                    slotIndex: activeBlock.start,
                  })}
                  {activeBlock.len ? `（${durationLabel(activeBlock.len, planDensity)}）` : ""}
                </span>
              ) : null}
            </DialogTitle>
          </DialogHeader>

          <div className={modalBodyClassName}>
            <div className="space-y-5">
              <div className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-50 p-3">
                <div className="col-span-4 text-sm text-muted-foreground">品目</div>
                <div className="col-span-8">
                  <SearchableCombobox
                    value={formItemId}
                    options={itemOptions}
                    onChange={(value) => setFormItemId(value)}
                    placeholder="品目を検索"
                    emptyLabel={items.length ? "該当する品目がありません" : "品目が未登録です"}
                    disabled={!items.length}
                  />
                </div>
              </div>
              <div className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-50 p-3">
                <div className="col-span-4 text-sm text-muted-foreground">生産数量</div>
                <div className="col-span-6">
                  <Input
                    inputMode="decimal"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="col-span-2 text-sm text-muted-foreground">{activeItem?.unit ?? ""}</div>
              </div>

              <div className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-50 p-3">
                <div className="col-span-4 text-sm text-muted-foreground">製造日</div>
                <div className="col-span-8 text-sm text-slate-700">
                  {activeManufactureDate ? `${activeManufactureDate} (${toMD(activeManufactureDate)})` : "未設定"}
                </div>
                <div className="col-span-4 text-sm text-muted-foreground">賞味期限</div>
                <div className="col-span-8 text-sm text-slate-700">
                  {activeExpirationDate ? `${activeExpirationDate} (${toMD(activeExpirationDate)})` : "未設定"}
                </div>
              </div>

              <Card className="rounded-2xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">原材料（数量から自動計算）</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {activeItem ? (
                    materials.map((m) => (
                      <div key={m.materialId} className="flex items-center justify-between">
                        <div className="text-sm">{m.materialName}</div>
                        <div className="font-medium">
                          {Number.isFinite(m.qty)
                            ? m.qty
                                .toFixed(3)
                                .replace(/\.0+$/, "")
                                .replace(/(\.[0-9]*?)0+$/, "$1")
                            : "0"}
                          <span className="ml-1 text-sm text-muted-foreground">{m.unit}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-muted-foreground"> </div>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-2">
                <div className="text-sm text-muted-foreground">メモ</div>
                <Textarea
                  value={formMemo}
                  onChange={(e) => setFormMemo(e.target.value)}
                  placeholder="段取り・注意点・引当メモなど"
                />
              </div>

              <AnimatePresence>
                {activeBlock ? (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    className="rounded-xl border p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-muted-foreground">現在のブロック</div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className={formApproved ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}
                        >
                          {formApproved ? "承認済み" : "未承認"}
                        </Badge>
                        <Button variant="outline" size="sm" onClick={toggleBlockApproval}>
                          {formApproved ? "未承認に戻す" : "承認する"}
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div>期間</div>
                      <div className="font-medium">
                        {slotLabelFromCalendar({
                          density: planDensity,
                          calendarDays: planCalendarDays,
                          hoursByDay: planCalendar.hoursByDay,
                          slotIndex: activeBlock.start,
                        })}
                        <span className="mx-1 text-muted-foreground">→</span>
                        {slotLabelFromCalendar({
                          density: planDensity,
                          calendarDays: planCalendarDays,
                          hoursByDay: planCalendar.hoursByDay,
                          slotIndex: Math.min(planSlotCount - 1, activeBlock.start + activeBlock.len - 1),
                        })}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handlePlanOpenChange(false)}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={onPlanDelete}>
              削除
            </Button>
            <Button onClick={onPlanSave}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  const masterSectionLabelMap: Record<"home" | "items" | "materials", string> = {
    home: "マスタ管理",
    items: "品目一覧",
    materials: "原料一覧",
  };

  const masterSectionDescriptionMap: Record<"home" | "items" | "materials", string> = {
    home: "品目・原料マスタの登録・編集・削除を行います。",
    items: "品目の計画方針・安全在庫・賞味期限・製造効率などを管理します。",
    materials: "原料の単位と名称を管理します。",
  };

  const masterView = (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-tight">{masterSectionLabelMap[masterSection]}</div>
          <div className="text-sm text-muted-foreground">{masterSectionDescriptionMap[masterSection]}</div>
        </div>
        {masterSection !== "home" ? (
          <Button variant="outline" size="sm" onClick={() => setMasterSection("home")}>
            マスタ管理へ戻る
          </Button>
        ) : null}
      </div>

      {masterSection === "home" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="rounded-2xl">
            <CardHeader className="space-y-2 pb-2">
              <CardTitle className="text-base font-medium">品目一覧</CardTitle>
              <div className="text-sm text-muted-foreground">
                品目マスタの確認・編集やレシピ登録を行います。
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="text-muted-foreground">登録件数: {items.length}件</div>
              <Button onClick={() => setMasterSection("items")}>品目一覧を開く</Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="space-y-2 pb-2">
              <CardTitle className="text-base font-medium">原料一覧</CardTitle>
              <div className="text-sm text-muted-foreground">原料マスタの確認・編集を行います。</div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="text-muted-foreground">登録件数: {materialsMaster.length}件</div>
              <Button onClick={() => setMasterSection("materials")}>原料一覧を開く</Button>
            </CardContent>
          </Card>
        </div>
      ) : masterSection === "items" ? (
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-medium">品目一覧</CardTitle>
            <Button onClick={openCreateItemModal}>品目を追加</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {items.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">品目名</th>
                      <th className="px-3 py-2 text-left font-medium">品目コード</th>
                      <th className="px-3 py-2 text-center font-medium">単位</th>
                      <th className="px-3 py-2 text-left font-medium">計画方針</th>
                      <th className="px-3 py-2 text-right font-medium">安全在庫</th>
                      <th className="px-3 py-2 text-right font-medium">賞味期限(日)</th>
                      <th className="px-3 py-2 text-right font-medium">製造効率</th>
                      <th className="px-3 py-2 text-left font-medium">備考</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item) => (
                      <tr key={item.id} className="align-middle">
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.name}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{item.publicId || "未設定"}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{item.unit}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {PLANNING_POLICY_LABELS[item.planningPolicy] ?? item.planningPolicy}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{item.safetyStock}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{item.shelfLifeDays}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          <span>{item.productionEfficiency}</span>
                          <span className="ml-1 text-xs text-slate-500">{item.unit}/人時</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <div className="max-w-[200px] truncate">{item.notes || "-"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => openRecipeEdit(item.id)}>
                              レシピ {item.recipe.length}件
                            </Button>
                            <Button variant="outline" onClick={() => openEditItemModal(item)}>
                              編集
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                品目マスタが未登録です。右上の「品目を追加」ボタンから追加してください。
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-medium">原料一覧</CardTitle>
            <Button onClick={openCreateMaterialModal}>原料を追加</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {materialsMaster.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">原料名</th>
                      <th className="px-3 py-2 text-left font-medium">単位</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {materialsMaster.map((material) => (
                      <tr key={material.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{material.name}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{material.unit}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => openEditMaterialModal(material)}>
                              編集
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                原料マスタが未登録です。右上の「原料を追加」ボタンから追加してください。
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );

  const importHeaderTooltips = {
    dailyStock: {
      date: "在庫を計上する対象日。\n形式: yyyyMMdd または yyyy-MM-dd",
      itemCode: "在庫を紐づける品目コード。\n形式: 品目マスタの品目コードと一致する文字列",
      stock: "対象日の在庫数量。\n形式: 数値（小数可）",
    },
    orders: {
      deliveryDate: "受注の納品予定日。\n形式: yyyyMMdd または yyyy-MM-dd",
      shipDate: "受注の出荷予定日。\n形式: yyyyMMdd または yyyy-MM-dd",
      itemCode: "受注対象の品目コード。\n形式: 品目マスタの品目コードと一致する文字列",
      quantity: "受注の数量。\n形式: 数値（小数可）",
    },
  };

  const importView = (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">Excel取り込み</div>
        <div className="text-sm text-muted-foreground">
          日別在庫・受注一覧・各マスタをExcelから取り込みます。
        </div>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">日別在庫（yyyyMMdd / 品目コード / 在庫数）</CardTitle>
          <div className="text-xs text-muted-foreground">最終更新: {formatUpdatedAt(dailyStockUpdatedAt)}</div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Input
            key={`daily-stock-${dailyStockInputKey}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await handleDailyStockImport(file);
            }}
          />
          <div className="rounded-lg border bg-muted/10 p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="font-semibold text-slate-700">ヘッダー指定（任意）</div>
                <div className="text-muted-foreground">
                  カンマ区切りで列名候補を追加できます。入力した候補を優先的に検索します。
                </div>
              </div>
              <Button size="sm" onClick={() => void saveImportHeaderOverrides("daily")} disabled={importHeaderSaveBusy}>
                設定を保存
              </Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  日付
                  <InfoTooltip text={importHeaderTooltips.dailyStock.date} />
                </div>
                <Input
                  value={dailyStockHeaderOverrides.date}
                  placeholder="例: 取込日, 入荷日"
                  onChange={(e) =>
                    setDailyStockHeaderOverrides((prev) => ({
                      ...prev,
                      date: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  品目コード
                  <InfoTooltip text={importHeaderTooltips.dailyStock.itemCode} />
                </div>
                <Input
                  value={dailyStockHeaderOverrides.itemCode}
                  placeholder="例: 商品コード, SKU"
                  onChange={(e) =>
                    setDailyStockHeaderOverrides((prev) => ({
                      ...prev,
                      itemCode: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  在庫数
                  <InfoTooltip text={importHeaderTooltips.dailyStock.stock} />
                </div>
                <Input
                  value={dailyStockHeaderOverrides.stock}
                  placeholder="例: 在庫数量, 残数"
                  onChange={(e) =>
                    setDailyStockHeaderOverrides((prev) => ({
                      ...prev,
                      stock: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {importHeaderSaveNote.daily ? (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                {importHeaderSaveNote.daily}
              </div>
            ) : null}
            {importHeaderSaveError.daily ? (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {importHeaderSaveError.daily}
              </div>
            ) : null}
          </div>
          {dailyStockImportNote ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              {dailyStockImportNote}
            </div>
          ) : null}
          {dailyStockImportError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {dailyStockImportError}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">受注一覧（納品日 / 出荷日 / 品目コード / 受注数）</CardTitle>
          <div className="text-xs text-muted-foreground">最終更新: {formatUpdatedAt(orderUpdatedAt)}</div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Input
            key={`orders-${orderInputKey}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await handleOrderImport(file);
            }}
          />
          <div className="rounded-lg border bg-muted/10 p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="font-semibold text-slate-700">ヘッダー指定（任意）</div>
                <div className="text-muted-foreground">
                  カンマ区切りで列名候補を追加できます。入力した候補を優先的に検索します。
                </div>
              </div>
              <Button size="sm" onClick={() => void saveImportHeaderOverrides("order")} disabled={importHeaderSaveBusy}>
                設定を保存
              </Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  納品日
                  <InfoTooltip text={importHeaderTooltips.orders.deliveryDate} />
                </div>
                <Input
                  value={orderHeaderOverrides.deliveryDate}
                  placeholder="例: 納品予定, 納期"
                  onChange={(e) =>
                    setOrderHeaderOverrides((prev) => ({
                      ...prev,
                      deliveryDate: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  出荷日
                  <InfoTooltip text={importHeaderTooltips.orders.shipDate} />
                </div>
                <Input
                  value={orderHeaderOverrides.shipDate}
                  placeholder="例: 出荷予定, 発送日"
                  onChange={(e) =>
                    setOrderHeaderOverrides((prev) => ({
                      ...prev,
                      shipDate: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  品目コード
                  <InfoTooltip text={importHeaderTooltips.orders.itemCode} />
                </div>
                <Input
                  value={orderHeaderOverrides.itemCode}
                  placeholder="例: 商品コード, SKU"
                  onChange={(e) =>
                    setOrderHeaderOverrides((prev) => ({
                      ...prev,
                      itemCode: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  受注数
                  <InfoTooltip text={importHeaderTooltips.orders.quantity} />
                </div>
                <Input
                  value={orderHeaderOverrides.quantity}
                  placeholder="例: 注文数, 数量"
                  onChange={(e) =>
                    setOrderHeaderOverrides((prev) => ({
                      ...prev,
                      quantity: e.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {importHeaderSaveNote.order ? (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                {importHeaderSaveNote.order}
              </div>
            ) : null}
            {importHeaderSaveError.order ? (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {importHeaderSaveError.order}
              </div>
            ) : null}
          </div>
          {orderImportNote ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              {orderImportNote}
            </div>
          ) : null}
          {orderImportError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {orderImportError}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">品目マスタ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="text-xs text-muted-foreground">
            必須列: 品目コード / 品目名。任意列: 単位 / 計画方針 / 安全在庫 / 賞味期限日数 / 製造効率 / 備考
          </div>
          <div className="text-xs text-muted-foreground">品目コードをキーに上書き・追加します。</div>
          <Input
            key={`item-master-${itemMasterInputKey}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await handleItemMasterImport(file);
            }}
          />
          {itemMasterImportNote ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              {itemMasterImportNote}
            </div>
          ) : null}
          {itemMasterImportError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {itemMasterImportError}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">原料マスタ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="text-xs text-muted-foreground">必須列: 原料コード / 原料名。任意列: 単位</div>
          <div className="text-xs text-muted-foreground">原料コードをキーに上書き・追加します。</div>
          <Input
            key={`material-master-${materialMasterInputKey}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await handleMaterialMasterImport(file);
            }}
          />
          {materialMasterImportNote ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              {materialMasterImportNote}
            </div>
          ) : null}
          {materialMasterImportError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {materialMasterImportError}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );

  const manualMarkdown = manualAudience === "user" ? manualUser : manualAdmin;

  const manualView = (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">操作マニュアル</div>
        <div className="text-sm text-muted-foreground">
          目的別に必要な操作を確認できます。利用対象を切り替えて参照してください。
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={manualAudience === "user" ? "default" : "outline"}
          size="sm"
          onClick={() => setManualAudience("user")}
        >
          一般利用者向け
        </Button>
        <Button
          variant={manualAudience === "admin" ? "default" : "outline"}
          size="sm"
          onClick={() => setManualAudience("admin")}
        >
          システム管理者向け
        </Button>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            {manualAudience === "user" ? "一般利用者向けマニュアル" : "システム管理者向けマニュアル"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h2 className="text-lg font-semibold text-slate-800">{children}</h2>,
              h2: ({ children }) => <h3 className="text-base font-semibold text-slate-800">{children}</h3>,
              h3: ({ children }) => <h4 className="text-sm font-semibold text-slate-700">{children}</h4>,
              p: ({ children }) => <p className="text-slate-700">{children}</p>,
              ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-slate-700">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-slate-700">{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-slate-800">{children}</strong>,
              code: ({ children }) => (
                <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-slate-800">{children}</code>
              ),
            }}
          >
            {manualMarkdown}
          </ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );

  const viewLabelMap: Record<"schedule" | "master" | "import" | "manual", string> = {
    schedule: "スケジュール",
    master: "マスタ管理",
    import: "Excel取り込み",
    manual: "マニュアル",
  };

  const masterViewLabelMap: Record<"home" | "items" | "materials", string> = {
    home: "マスタ管理",
    items: "マスタ管理 / 品目一覧",
    materials: "マスタ管理 / 原料一覧",
  };

  const viewLabel = activeView === "master" ? masterViewLabelMap[masterSection] : viewLabelMap[activeView];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div
        className={`fixed inset-0 z-[70] bg-black/30 transition ${
          navOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setNavOpen(false)}
      />
      <aside
        className={`fixed left-0 top-0 z-[80] h-full w-64 border-r bg-background shadow-sm transition-transform ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">メニュー</div>
            <button
              type="button"
              className="rounded-md border px-2 py-1 text-sm"
              onClick={() => setNavOpen(false)}
            >
              閉じる
            </button>
          </div>
          <nav className="space-y-1">
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "schedule" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => {
                setActiveView("schedule");
                setNavOpen(false);
              }}
            >
              スケジュール
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "import" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => {
                setActiveView("import");
                setNavOpen(false);
              }}
            >
              Excel取り込み
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "master" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => {
                setActiveView("master");
                setMasterSection("home");
                setNavOpen(false);
              }}
            >
              マスタ管理
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "manual" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => {
                setActiveView("manual");
                setNavOpen(false);
              }}
            >
              マニュアル
            </button>
          </nav>
        </div>
      </aside>

      <div className="min-h-screen">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
          <button
            type="button"
            className="rounded-md border p-2 hover:bg-muted"
            onClick={() => setNavOpen((prev) => !prev)}
            aria-label="メニューを開く"
          >
            <span className="block h-0.5 w-5 bg-foreground" />
            <span className="mt-1 block h-0.5 w-5 bg-foreground" />
            <span className="mt-1 block h-0.5 w-5 bg-foreground" />
          </button>
          <div>
            <div className="text-sm text-muted-foreground">画面</div>
            <div className="text-base font-semibold">{viewLabel}</div>
          </div>
        </header>

        <main className="p-4">
          {activeView === "schedule"
            ? scheduleView
            : activeView === "master"
              ? masterView
              : activeView === "import"
                ? importView
                : manualView}
        </main>

        {/* 品目マスタモーダル */}
        <Dialog open={isItemModalOpen} onOpenChange={handleItemModalOpenChange}>
          <DialogContent className={modalWideClassName}>
            <DialogHeader>
              <DialogTitle>{isItemEditMode ? "品目を編集" : "品目を追加"}</DialogTitle>
            </DialogHeader>

            <div className={modalBodyClassName}>
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
                  <div className="text-sm font-medium text-muted-foreground">品目名</div>
                  <Input
                    value={isItemEditMode ? editingItemName : itemNameDraft}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (isItemEditMode) {
                        setEditingItemName(next);
                      } else {
                        setItemNameDraft(next);
                      }
                      setItemFormError(null);
                    }}
                    placeholder="品目名"
                  />
                  <div className="text-sm font-medium text-muted-foreground">品目コード</div>
                  <Input
                    value={isItemEditMode ? editingItemPublicId : itemPublicIdDraft}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (isItemEditMode) {
                        setEditingItemPublicId(next);
                      } else {
                        setItemPublicIdDraft(next);
                      }
                      setItemFormError(null);
                    }}
                    placeholder="品目コード"
                  />
                  <div className="text-sm font-medium text-muted-foreground">単位</div>
                  <Select
                    value={isItemEditMode ? editingItemUnit : itemUnitDraft}
                    onValueChange={(value) => {
                      if (isItemEditMode) {
                        setEditingItemUnit(value as ItemUnit);
                      } else {
                        setItemUnitDraft(value as ItemUnit);
                      }
                      setItemFormError(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="単位" />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="text-sm font-medium text-muted-foreground">計画方針</div>
                  <Select
                    value={isItemEditMode ? editingItemPlanningPolicy : itemPlanningPolicyDraft}
                    onValueChange={(value) => {
                      if (isItemEditMode) {
                        setEditingItemPlanningPolicy(value as PlanningPolicy);
                      } else {
                        setItemPlanningPolicyDraft(value as PlanningPolicy);
                      }
                      setItemFormError(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="計画方針" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="make_to_stock">見込生産</SelectItem>
                      <SelectItem value="make_to_order">受注生産</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="text-sm font-medium text-muted-foreground">安全在庫</div>
                  <Input
                    inputMode="decimal"
                    value={isItemEditMode ? editingItemSafetyStock : itemSafetyStockDraft}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (isItemEditMode) {
                        setEditingItemSafetyStock(next);
                      } else {
                        setItemSafetyStockDraft(next);
                      }
                      setItemFormError(null);
                    }}
                    placeholder="安全在庫"
                  />
                  <div className="text-sm font-medium text-muted-foreground">賞味期限（日数）</div>
                  <Input
                    inputMode="decimal"
                    value={isItemEditMode ? editingItemShelfLifeDays : itemShelfLifeDaysDraft}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (isItemEditMode) {
                        setEditingItemShelfLifeDays(next);
                      } else {
                        setItemShelfLifeDaysDraft(next);
                      }
                      setItemFormError(null);
                    }}
                    placeholder="賞味期限（日数）"
                  />
                  <div className="text-sm font-medium text-muted-foreground">製造効率</div>
                  <div className="flex items-center gap-2">
                    <Input
                      className="flex-1"
                      inputMode="decimal"
                      value={isItemEditMode ? editingItemProductionEfficiency : itemProductionEfficiencyDraft}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (isItemEditMode) {
                          setEditingItemProductionEfficiency(next);
                        } else {
                          setItemProductionEfficiencyDraft(next);
                        }
                        setItemFormError(null);
                      }}
                      placeholder="1人1時間あたりの製造数量"
                    />
                    <span className="text-xs text-muted-foreground">{itemEfficiencyUnit}/人時</span>
                  </div>
                  <div className="text-sm font-medium text-muted-foreground">備考</div>
                  <Textarea
                    value={isItemEditMode ? editingItemNotes : itemNotesDraft}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (isItemEditMode) {
                        setEditingItemNotes(next);
                      } else {
                        setItemNotesDraft(next);
                      }
                      setItemFormError(null);
                    }}
                    placeholder="自由記入（長文可）"
                  />
                </div>
                {itemFormError ? <div className="mt-4 text-sm text-destructive">{itemFormError}</div> : null}
              </div>
            </div>

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={() => handleItemModalOpenChange(false)}>
                キャンセル
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                {isItemEditMode ? (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (!editingItemId) return;
                      const didDelete = onDeleteItem(editingItemId);
                      if (didDelete) {
                        setIsItemModalOpen(false);
                      }
                    }}
                  >
                    削除
                  </Button>
                ) : null}
                <Button onClick={handleItemModalSave}>{isItemEditMode ? "保存" : "追加"}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 原料マスタモーダル */}
        <Dialog open={isMaterialModalOpen} onOpenChange={handleMaterialModalOpenChange}>
          <DialogContent className={modalWideClassName}>
            <DialogHeader>
              <DialogTitle>{isMaterialEditMode ? "原料を編集" : "原料を追加"}</DialogTitle>
            </DialogHeader>

            <div className={modalBodyClassName}>
              <div className="rounded-xl border bg-white p-4 shadow-sm">
                <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
                  <div className="text-sm font-medium text-muted-foreground">原料名</div>
                  <Input
                    value={isMaterialEditMode ? editingMaterialName : materialNameDraft}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (isMaterialEditMode) {
                        setEditingMaterialName(next);
                      } else {
                        setMaterialNameDraft(next);
                      }
                      setMaterialFormError(null);
                    }}
                    placeholder="原料名"
                  />
                  <div className="text-sm font-medium text-muted-foreground">単位</div>
                  <Select
                    value={isMaterialEditMode ? editingMaterialUnit : materialUnitDraft}
                    onValueChange={(value) => {
                      if (isMaterialEditMode) {
                        setEditingMaterialUnit(value as RecipeUnit);
                      } else {
                        setMaterialUnitDraft(value as RecipeUnit);
                      }
                      setMaterialFormError(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="単位" />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {materialFormError ? <div className="mt-4 text-sm text-destructive">{materialFormError}</div> : null}
              </div>
            </div>

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
              <Button variant="outline" onClick={() => handleMaterialModalOpenChange(false)}>
                キャンセル
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                {isMaterialEditMode ? (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (!editingMaterialId) return;
                      const didDelete = onDeleteMaterial(editingMaterialId);
                      if (didDelete) {
                        setIsMaterialModalOpen(false);
                      }
                    }}
                  >
                    削除
                  </Button>
                ) : null}
                <Button onClick={handleMaterialModalSave}>{isMaterialEditMode ? "保存" : "追加"}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* レシピ設定モーダル */}
        <Dialog open={openRecipe} onOpenChange={setOpenRecipe}>
          <DialogContent className={modalWideClassName}>
            <DialogHeader>
              <DialogTitle>レシピ設定{activeRecipeItem ? `：${activeRecipeItem.name}` : ""}</DialogTitle>
            </DialogHeader>

            <div className={modalBodyClassName}>
              <div className="space-y-4">
                <div className="rounded-lg bg-slate-50 p-3 text-sm text-muted-foreground">
                  係数は「製品1{activeRecipeItem?.unit ?? ""}あたりの原料量」です。
                </div>
                <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  原料はマスタから選択します。未登録の場合は「マスタ管理」画面で追加してください。
                </div>

                <div className="rounded-xl border">
                  <div className="grid grid-cols-12 gap-2 border-b bg-muted/30 p-2 text-xs text-muted-foreground">
                    <div className="col-span-6">原材料名</div>
                    <div className="col-span-3 text-right">係数</div>
                    <div className="col-span-2">単位</div>
                    <div className="col-span-1 text-right"> </div>
                  </div>

                  <div className="divide-y">
                    {recipeDraft.map((r, idx) => (
                      <div key={`${r.materialId}-${idx}`} className="grid grid-cols-12 items-center gap-2 p-2">
                        <div className="col-span-6">
                          <SearchableCombobox
                            value={r.materialId}
                            options={materialOptions}
                            onChange={(value) => {
                              const selected = materialMap.get(value);
                              setRecipeDraft((prev) =>
                                prev.map((x, i) =>
                                  i === idx
                                    ? {
                                        ...x,
                                        materialId: value,
                                        unit: selected?.unit ?? x.unit,
                                      }
                                    : x
                                )
                              );
                            }}
                            placeholder="原料を検索"
                            emptyLabel={materialsMaster.length ? "該当する原料がありません" : "原料が未登録です"}
                            disabled={!materialsMaster.length}
                          />
                        </div>
                        <div className="col-span-3">
                          <Input
                            inputMode="decimal"
                            value={String(r.perUnit)}
                            onChange={(e) => {
                              const v = e.target.value;
                              setRecipeDraft((prev) =>
                                prev.map((x, i) => (i === idx ? { ...x, perUnit: safeNumber(v) } : x))
                              );
                            }}
                          />
                        </div>
                        <div className="col-span-2">
                          <Select
                            value={r.unit}
                            onValueChange={(v) => {
                              const unit = asRecipeUnit(v);
                              setRecipeDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, unit } : x)));
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="単位" />
                            </SelectTrigger>
                            <SelectContent>
                              {ITEM_UNITS.map((unit) => (
                                <SelectItem key={unit} value={unit}>
                                  {unit}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-1 text-right">
                          <Button
                            variant="outline"
                            onClick={() => setRecipeDraft((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            -
                          </Button>
                        </div>
                      </div>
                    ))}

                    <div className="p-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          const fallbackMaterial = materialsMaster[0];
                          setRecipeDraft((prev) => [
                            ...prev,
                            {
                              materialId: fallbackMaterial?.id ?? "",
                              perUnit: 0,
                              unit: fallbackMaterial?.unit ?? DEFAULT_MATERIAL_UNIT,
                            },
                          ]);
                        }}
                      >
                        追加
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setOpenRecipe(false)}>
                キャンセル
              </Button>
              <Button onClick={onRecipeSave}>保存</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
