import React, { useEffect, useMemo, useRef, useState } from "react";
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

type RecipeUnit = "kg" | "g";

type ItemUnit = "cs" | "kg";

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
  name: string;
  unit: ItemUnit;
  stock: number;
  planningPolicy: PlanningPolicy;
  safetyStock: number;
  reorderPoint: number;
  lotSize: number;
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
  schemaVersion: "1.0.0";
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
    name: string;
    unit: ItemUnit;
    stock: number;
    planningPolicy: PlanningPolicy;
    safetyStock: number;
    reorderPoint: number;
    lotSize: number;
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
  constraints: Record<string, unknown>;
};

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatAction = {
  type: "create_block" | "update_block" | "delete_block";
  blockId?: string;
  itemId?: string;
  itemName?: string;
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
    unit: "cs",
    stock: 140,
    planningPolicy: "make_to_stock",
    safetyStock: 20,
    reorderPoint: 60,
    lotSize: 50,
    recipe: [
      { materialId: "MAT-A", perUnit: 0.25, unit: "kg" },
      { materialId: "MAT-B", perUnit: 0.5, unit: "kg" },
    ],
  },
  {
    id: "B",
    name: "Item B",
    unit: "cs",
    stock: 70,
    planningPolicy: "make_to_order",
    safetyStock: 10,
    reorderPoint: 30,
    lotSize: 40,
    recipe: [
      { materialId: "MAT-A", perUnit: 0.1, unit: "kg" },
      { materialId: "MAT-C", perUnit: 0.2, unit: "kg" },
    ],
  },
  {
    id: "C",
    name: "Item C",
    unit: "kg",
    stock: 320,
    planningPolicy: "make_to_stock",
    safetyStock: 50,
    reorderPoint: 120,
    lotSize: 100,
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

function buildDefaultCalendarDays(start: Date): CalendarDay[] {
  const out: CalendarDay[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
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
  return value === "kg" ? "kg" : "cs";
}

function asPlanningPolicy(value: unknown): PlanningPolicy {
  return value === "make_to_order" ? "make_to_order" : "make_to_stock";
}

function asRecipeUnit(value: unknown): RecipeUnit {
  return value === "g" ? "g" : "kg";
}

function asDensity(value: unknown): Density {
  return value === "day" || value === "2hour" || value === "hour" ? value : "hour";
}

function sanitizeItems(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      const id = asString(record.id).trim();
      const name = asString(record.name).trim();
      if (!id || !name) return null;
      const unit = asItemUnit(record.unit);
      const stock = asNumber(record.stock);
      const planningPolicy = asPlanningPolicy(record.planningPolicy ?? record.planning_policy);
      const safetyStock = Math.max(0, asNumber(record.safetyStock ?? record.safety_stock));
      const reorderPoint = Math.max(0, asNumber(record.reorderPoint ?? record.reorder_point));
      const lotSize = Math.max(0, asNumber(record.lotSize ?? record.lot_size));
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
        name,
        unit,
        stock,
        planningPolicy,
        safetyStock,
        reorderPoint,
        lotSize,
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
    schemaVersion: "1.0.0",
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
      name: it.name,
      unit: it.unit,
      stock: it.stock,
      planningPolicy: it.planningPolicy,
      safetyStock: it.safetyStock,
      reorderPoint: it.reorderPoint,
      lotSize: it.lotSize,
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
    constraints: {},
  };
}

type DragKind = "move" | "resizeL" | "resizeR";

type DragState = {
  kind: DragKind;
  blockId: string;
  originStart: number;
  originLen: number;
  laneRect: { left: number; width: number };
  dayIndex: number;
  moved: boolean;
};

export default function ManufacturingPlanGanttApp(): JSX.Element {
  const [navOpen, setNavOpen] = useState(false);
  const [activeView, setActiveView] = useState<"schedule" | "master">("schedule");
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
  const [itemNameDraft, setItemNameDraft] = useState("");
  const [itemUnitDraft, setItemUnitDraft] = useState<ItemUnit>("cs");
  const [itemStockDraft, setItemStockDraft] = useState("0");
  const [itemPlanningPolicyDraft, setItemPlanningPolicyDraft] = useState<PlanningPolicy>("make_to_stock");
  const [itemSafetyStockDraft, setItemSafetyStockDraft] = useState("0");
  const [itemReorderPointDraft, setItemReorderPointDraft] = useState("0");
  const [itemLotSizeDraft, setItemLotSizeDraft] = useState("0");
  const [itemFormError, setItemFormError] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState("");
  const [editingItemUnit, setEditingItemUnit] = useState<ItemUnit>("cs");
  const [editingItemStock, setEditingItemStock] = useState("0");
  const [editingItemPlanningPolicy, setEditingItemPlanningPolicy] = useState<PlanningPolicy>("make_to_stock");
  const [editingItemSafetyStock, setEditingItemSafetyStock] = useState("0");
  const [editingItemReorderPoint, setEditingItemReorderPoint] = useState("0");
  const [editingItemLotSize, setEditingItemLotSize] = useState("0");

  const viewCalendarDays = useMemo(() => {
    const planStart = planCalendarDays[0]?.date;
    if (planStart && toISODate(viewWeekStart) === planStart) return planCalendarDays;
    return buildDefaultCalendarDays(viewWeekStart);
  }, [planCalendarDays, viewWeekStart]);

  const viewCalendar = useMemo(
    () => buildCalendarSlots(viewCalendarDays, viewDensity),
    [viewCalendarDays, viewDensity]
  );
  const weekDates = useMemo(() => viewCalendarDays.map((day) => day.date), [viewCalendarDays]);
  const slotsPerDay = viewCalendar.slotsPerDay;
  const slotCount = viewCalendar.slotCount;
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

  const planStartISO = planCalendarDays[0]?.date ?? toISODate(planWeekStart);
  const isPlanWeekView = toISODate(viewWeekStart) === planStartISO;

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
  const [materialUnitDraft, setMaterialUnitDraft] = useState<RecipeUnit>("kg");
  const [materialFormError, setMaterialFormError] = useState<string | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [editingMaterialName, setEditingMaterialName] = useState("");
  const [editingMaterialUnit, setEditingMaterialUnit] = useState<RecipeUnit>("kg");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const [constraintsText, setConstraintsText] = useState("");
  const [constraintsDraft, setConstraintsDraft] = useState("");
  const [constraintsBusy, setConstraintsBusy] = useState(false);
  const [constraintsError, setConstraintsError] = useState<string | null>(null);
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
        effectiveWeekStart.setHours(0, 0, 0, 0);
        const nextCalendarDays = payload.calendarDays.length
          ? payload.calendarDays
          : buildDefaultCalendarDays(effectiveWeekStart);
        const normalizedWeekStart = new Date(nextCalendarDays[0]?.date ?? payload.weekStartISO);
        if (!Number.isNaN(normalizedWeekStart.getTime())) {
          normalizedWeekStart.setHours(0, 0, 0, 0);
          setPlanWeekStart(normalizedWeekStart);
          setViewWeekStart(normalizedWeekStart);
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
    const blockSummaries = blocks.map((b) => ({
      id: b.id,
      itemId: b.itemId,
      itemName: itemMap.get(b.itemId)?.name ?? "",
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

    return JSON.stringify(
      {
        weekStartISO: planWeekDates[0],
        density: planDensity,
        slotsPerDay: planSlotsPerDay,
        slotCount: planSlotCount,
        slotIndexToLabel: planSlotIndexToLabel,
        calendarDays: planCalendarDays,
        materials: materialsMaster,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          unit: item.unit,
          stock: item.stock,
          planningPolicy: item.planningPolicy,
          safetyStock: item.safetyStock,
          reorderPoint: item.reorderPoint,
          lotSize: item.lotSize,
          recipe: item.recipe.map((line) => ({
            ...line,
            materialName: materialMap.get(line.materialId)?.name ?? "未登録原料",
          })),
        })),
        blocks: blockSummaries,
      },
      null,
      2
    );
  };

  const resolveItemId = (action: ChatAction) => {
    if (action.itemId && items.some((x) => x.id === action.itemId)) return action.itemId;
    if (action.itemName) {
      const match = items.find((x) => x.name.toLowerCase() === action.itemName?.toLowerCase());
      if (match) return match.id;
    }
    return null;
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
    const userMessage: ChatMessage = { id: userMessageId, role: "user", content: trimmed };
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
      '      "blockId": "既存ブロックID（更新/削除時に推奨）",',
      '      "itemId": "品目ID",',
      '      "itemName": "品目名（itemIdが不明な場合）",',
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

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: geminiModel,
          systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
          contents: [
            ...chatMessages.map((msg) => ({
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
        const assistantMessage: ChatMessage = { id: uid("chat"), role: "assistant", content: message };
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
        const assistantMessage: ChatMessage = { id: uid("chat"), role: "assistant", content: message };
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
      const response = await fetch("/api/constraints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: constraintsDraft }),
      });
      if (!response.ok) {
        throw new Error("保存に失敗しました。");
      }
      setConstraintsText(constraintsDraft);
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
    const absoluteSlot = dayIndex * slotsPerDay + workingSlot;
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

    suppressClickRef.current = true;

    dragStateRef.current = {
      kind: p.kind,
      blockId: p.blockId,
      originStart: block.start,
      originLen: block.len,
      laneRect: { left: rect.left, width: rect.width },
      dayIndex: p.dayIndex,
      moved: false,
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = dragStateRef.current;
    if (!s) return;

    const slot = xToSlot(e.clientX, s.laneRect, slotsPerDay);
    const workingSlot = clampToWorkingSlot(s.dayIndex, slot, viewCalendar.rawHoursByDay);
    if (workingSlot === null) return;
    const absoluteSlot = s.dayIndex * slotsPerDay + workingSlot;
    const planSlot = clamp(convertSlotIndex(absoluteSlot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const planSlotEnd = clamp(convertSlotIndex(absoluteSlot + 1, viewDensity, planDensity, "ceil"), 1, planSlotCount);
    s.moved = true;

    setBlocks((prev) => {
      const next = prev.map((b) => {
        if (b.id !== s.blockId) return b;

        if (s.kind === "move") {
          const start = clamp(planSlot, 0, planSlotCount - 1);
          const len = clamp(s.originLen, 1, planSlotCount - start);
          return resolveOverlap({ ...b, start, len }, prev);
        }

        if (s.kind === "resizeL") {
          const end = s.originStart + s.originLen;
          const newStart = clamp(planSlot, 0, end - 1);
          const newLen = clamp(end - newStart, 1, planSlotCount - newStart);
          return resolveOverlap({ ...b, start: newStart, len: newLen }, prev);
        }

        const newEnd = clamp(planSlotEnd, b.start + 1, planSlotCount);
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
  }, [planDensity, planSlotCount, slotsPerDay, viewCalendar, viewDensity]);

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
                  unit: r.unit === "g" ? "g" : "kg",
                }))
                .filter((r) => r.materialId.length > 0 && validMaterialIds.has(r.materialId)),
            }
          : it
      )
    );
    setOpenRecipe(false);
  };

  const onCreateItem = () => {
    const name = itemNameDraft.trim();
    if (!name) {
      setItemFormError("品目名を入力してください。");
      return;
    }
    if (items.some((it) => it.name === name)) {
      setItemFormError("同じ品目名がすでに登録されています。");
      return;
    }
    const stock = Math.max(0, safeNumber(itemStockDraft));
    const safetyStock = Math.max(0, safeNumber(itemSafetyStockDraft));
    const reorderPoint = Math.max(0, safeNumber(itemReorderPointDraft));
    const lotSize = Math.max(0, safeNumber(itemLotSizeDraft));
    const newItem: Item = {
      id: uid("item"),
      name,
      unit: itemUnitDraft,
      stock,
      planningPolicy: itemPlanningPolicyDraft,
      safetyStock,
      reorderPoint,
      lotSize,
      recipe: [],
    };
    setItems((prev) => [...prev, newItem]);
    setItemNameDraft("");
    setItemUnitDraft("cs");
    setItemStockDraft("0");
    setItemPlanningPolicyDraft("make_to_stock");
    setItemSafetyStockDraft("0");
    setItemReorderPointDraft("0");
    setItemLotSizeDraft("0");
    setItemFormError(null);
  };

  const onStartEditItem = (item: Item) => {
    setEditingItemId(item.id);
    setEditingItemName(item.name);
    setEditingItemUnit(item.unit);
    setEditingItemStock(String(item.stock ?? 0));
    setEditingItemPlanningPolicy(item.planningPolicy ?? "make_to_stock");
    setEditingItemSafetyStock(String(item.safetyStock ?? 0));
    setEditingItemReorderPoint(String(item.reorderPoint ?? 0));
    setEditingItemLotSize(String(item.lotSize ?? 0));
    setItemFormError(null);
  };

  const onCancelEditItem = () => {
    setEditingItemId(null);
    setEditingItemName("");
    setEditingItemUnit("cs");
    setEditingItemStock("0");
    setEditingItemPlanningPolicy("make_to_stock");
    setEditingItemSafetyStock("0");
    setEditingItemReorderPoint("0");
    setEditingItemLotSize("0");
    setItemFormError(null);
  };

  const onSaveEditItem = () => {
    if (!editingItemId) return;
    const nextName = editingItemName.trim();
    if (!nextName) {
      setItemFormError("品目名を入力してください。");
      return;
    }
    if (items.some((it) => it.name === nextName && it.id !== editingItemId)) {
      setItemFormError("同じ品目名がすでに登録されています。");
      return;
    }
    const nextStock = Math.max(0, safeNumber(editingItemStock));
    const nextSafetyStock = Math.max(0, safeNumber(editingItemSafetyStock));
    const nextReorderPoint = Math.max(0, safeNumber(editingItemReorderPoint));
    const nextLotSize = Math.max(0, safeNumber(editingItemLotSize));
    setItems((prev) =>
      prev.map((it) =>
        it.id === editingItemId
          ? {
              ...it,
              name: nextName,
              unit: editingItemUnit,
              stock: nextStock,
              planningPolicy: editingItemPlanningPolicy,
              safetyStock: nextSafetyStock,
              reorderPoint: nextReorderPoint,
              lotSize: nextLotSize,
            }
          : it
      )
    );
    setItemFormError(null);
    onCancelEditItem();
  };

  const onDeleteItem = (itemId: string) => {
    const target = items.find((it) => it.id === itemId);
    if (!target) return;
    const confirmed = window.confirm(`${target.name} を削除しますか？`);
    if (!confirmed) return;
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
  };

  const onCreateMaterial = () => {
    const name = materialNameDraft.trim();
    if (!name) {
      setMaterialFormError("原料名を入力してください。");
      return;
    }
    if (materialsMaster.some((m) => m.name === name)) {
      setMaterialFormError("同じ原料名がすでに登録されています。");
      return;
    }
    const newMaterial: Material = {
      id: uid("mat"),
      name,
      unit: materialUnitDraft,
    };
    setMaterialsMaster((prev) => [...prev, newMaterial]);
    setMaterialNameDraft("");
    setMaterialUnitDraft("kg");
    setMaterialFormError(null);
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
    setEditingMaterialUnit("kg");
    setMaterialFormError(null);
  };

  const onSaveEditMaterial = () => {
    if (!editingMaterialId) return;
    const nextName = editingMaterialName.trim();
    if (!nextName) {
      setMaterialFormError("原料名を入力してください。");
      return;
    }
    if (materialsMaster.some((m) => m.name === nextName && m.id !== editingMaterialId)) {
      setMaterialFormError("同じ原料名がすでに登録されています。");
      return;
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
  };

  const onDeleteMaterial = (materialId: string) => {
    const target = materialsMaster.find((m) => m.id === materialId);
    if (!target) return;
    const confirmed = window.confirm(`${target.name} を削除しますか？`);
    if (!confirmed) return;
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
  };

  const eodStockByItem = useMemo(() => {
    const blocksForEod = isPlanWeekView ? blocks : [];
    const out: Record<string, number[]> = {};

    for (const it of items) {
      const addByDay = new Array(7).fill(0);
      for (const b of blocksForEod) {
        if (b.itemId !== it.id) continue;
        const d = clamp(endDayIndex(b, planSlotsPerDay), 0, 6);
        addByDay[d] += Number.isFinite(b.amount) ? b.amount : 0;
      }
      const eod = new Array(7).fill(0);
      let cur = it.stock;
      for (let d = 0; d < 7; d += 1) {
        cur += addByDay[d];
        eod[d] = cur;
      }
      out[it.id] = eod;
    }

    return out;
  }, [blocks, isPlanWeekView, items, planSlotsPerDay]);

  const eodSummaryByDay = useMemo(() => {
    const blocksForEod = isPlanWeekView ? blocks : [];
    const itemsByDay: Record<number, Set<string>> = {};

    for (const b of blocksForEod) {
      const d = clamp(endDayIndex(b, planSlotsPerDay), 0, 6);
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
  }, [blocks, eodStockByItem, isPlanWeekView, itemMap, planSlotsPerDay, weekDates]);

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
                  const viewStart = clamp(
                    convertSlotIndex(b.start, planDensity, viewDensity, "floor"),
                    0,
                    slotCount - 1
                  );
                  const viewLen = clamp(
                    convertSlotLength(b.len, planDensity, viewDensity, "ceil"),
                    1,
                    slotCount - viewStart
                  );
                  const viewDayIdx = Math.floor(viewStart / slotsPerDay);
                  const viewStartInDay = viewStart - viewDayIdx * slotsPerDay;
                  const maxLen = Math.max(1, slotsPerDay - viewStartInDay);
                  return {
                    block: b,
                    viewDayIdx,
                    viewStartInDay,
                    viewLen: clamp(viewLen, 1, maxLen),
                  };
                })
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
                placeholder="例：Item A を 9/12 10:00から2時間、40cs 追加して"
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
                <Textarea
                  value={constraintsDraft}
                  onChange={(e) => setConstraintsDraft(e.target.value)}
                  className="min-h-[220px]"
                  placeholder="例：設備Xは午前のみ稼働、残業は不可、最小ロットは50cs など"
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
                  <Select value={formItemId} onValueChange={(value) => setFormItemId(value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="品目を選択" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.length ? (
                        items.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="__none__" disabled>
                          品目が未登録です
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
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

  const masterView = (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">マスタ管理</div>
        <div className="text-sm text-muted-foreground">品目・原料マスタの登録・編集・削除を行います。</div>
      </div>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">品目を追加</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-5">
              <Input
                value={itemNameDraft}
                onChange={(e) => {
                  setItemNameDraft(e.target.value);
                  setItemFormError(null);
                }}
                placeholder="品目名"
              />
            </div>
            <div className="col-span-2">
              <Select
                value={itemUnitDraft}
                onValueChange={(value) => {
                  setItemUnitDraft(value as ItemUnit);
                  setItemFormError(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="単位" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cs">cs</SelectItem>
                  <SelectItem value="kg">kg</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3">
              <Select
                value={itemPlanningPolicyDraft}
                onValueChange={(value) => {
                  setItemPlanningPolicyDraft(value as PlanningPolicy);
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
            </div>
            <div className="col-span-2">
              <Input
                inputMode="decimal"
                value={itemStockDraft}
                onChange={(e) => {
                  setItemStockDraft(e.target.value);
                  setItemFormError(null);
                }}
                placeholder="開始在庫"
              />
            </div>
          </div>
          <div className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-3">
              <Input
                inputMode="decimal"
                value={itemSafetyStockDraft}
                onChange={(e) => {
                  setItemSafetyStockDraft(e.target.value);
                  setItemFormError(null);
                }}
                placeholder="安全在庫"
              />
            </div>
            <div className="col-span-3">
              <Input
                inputMode="decimal"
                value={itemReorderPointDraft}
                onChange={(e) => {
                  setItemReorderPointDraft(e.target.value);
                  setItemFormError(null);
                }}
                placeholder="発注点"
              />
            </div>
            <div className="col-span-3">
              <Input
                inputMode="decimal"
                value={itemLotSizeDraft}
                onChange={(e) => {
                  setItemLotSizeDraft(e.target.value);
                  setItemFormError(null);
                }}
                placeholder="ロットサイズ"
              />
            </div>
            <div className="col-span-3">
              <Button onClick={onCreateItem} className="w-full">
                追加
              </Button>
            </div>
          </div>
          {itemFormError ? <div className="text-sm text-destructive">{itemFormError}</div> : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">品目一覧</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.length ? (
            <div className="divide-y rounded-lg border">
              <div className="grid grid-cols-12 gap-2 bg-muted/30 p-2 text-xs text-muted-foreground">
                <div className="col-span-3">品目名</div>
                <div className="col-span-1 text-center">単位</div>
                <div className="col-span-2">計画方針</div>
                <div className="col-span-1 text-right">在庫</div>
                <div className="col-span-1 text-right">安全在庫</div>
                <div className="col-span-1 text-right">発注点</div>
                <div className="col-span-1 text-right">ロット</div>
                <div className="col-span-2 text-right">操作</div>
              </div>
              {items.map((item) => {
                const isEditing = editingItemId === item.id;
                return (
                  <div key={item.id} className="grid grid-cols-12 items-center gap-2 p-2">
                    <div className="col-span-3">
                      {isEditing ? (
                        <Input
                          value={editingItemName}
                          onChange={(e) => {
                            setEditingItemName(e.target.value);
                            setItemFormError(null);
                          }}
                        />
                      ) : (
                        <div className="text-sm font-medium">{item.name}</div>
                      )}
                    </div>
                    <div className="col-span-1">
                      {isEditing ? (
                        <Select value={editingItemUnit} onValueChange={(value) => setEditingItemUnit(value as ItemUnit)}>
                          <SelectTrigger>
                            <SelectValue placeholder="単位" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cs">cs</SelectItem>
                            <SelectItem value="kg">kg</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-center text-sm text-muted-foreground">{item.unit}</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {isEditing ? (
                        <Select
                          value={editingItemPlanningPolicy}
                          onValueChange={(value) => setEditingItemPlanningPolicy(value as PlanningPolicy)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="計画方針" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="make_to_stock">見込生産</SelectItem>
                            <SelectItem value="make_to_order">受注生産</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          {PLANNING_POLICY_LABELS[item.planningPolicy] ?? item.planningPolicy}
                        </div>
                      )}
                    </div>
                    <div className="col-span-1 text-right">
                      {isEditing ? (
                        <Input
                          inputMode="decimal"
                          value={editingItemStock}
                          onChange={(e) => {
                            setEditingItemStock(e.target.value);
                            setItemFormError(null);
                          }}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground">{item.stock}</div>
                      )}
                    </div>
                    <div className="col-span-1 text-right">
                      {isEditing ? (
                        <Input
                          inputMode="decimal"
                          value={editingItemSafetyStock}
                          onChange={(e) => {
                            setEditingItemSafetyStock(e.target.value);
                            setItemFormError(null);
                          }}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground">{item.safetyStock}</div>
                      )}
                    </div>
                    <div className="col-span-1 text-right">
                      {isEditing ? (
                        <Input
                          inputMode="decimal"
                          value={editingItemReorderPoint}
                          onChange={(e) => {
                            setEditingItemReorderPoint(e.target.value);
                            setItemFormError(null);
                          }}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground">{item.reorderPoint}</div>
                      )}
                    </div>
                    <div className="col-span-1 text-right">
                      {isEditing ? (
                        <Input
                          inputMode="decimal"
                          value={editingItemLotSize}
                          onChange={(e) => {
                            setEditingItemLotSize(e.target.value);
                            setItemFormError(null);
                          }}
                        />
                      ) : (
                        <div className="text-sm text-muted-foreground">{item.lotSize}</div>
                      )}
                    </div>
                    <div className="col-span-2 flex justify-end gap-2">
                      {isEditing ? (
                        <>
                          <Button variant="outline" onClick={onCancelEditItem}>
                            キャンセル
                          </Button>
                          <Button onClick={onSaveEditItem}>保存</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="outline" onClick={() => openRecipeEdit(item.id)}>
                            レシピ {item.recipe.length}件
                          </Button>
                          <Button variant="outline" onClick={() => onStartEditItem(item)}>
                            編集
                          </Button>
                          <Button variant="destructive" onClick={() => onDeleteItem(item.id)}>
                            削除
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              品目マスタが未登録です。上のフォームから追加してください。
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">原料を追加</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-12 items-center gap-2">
            <div className="col-span-6">
              <Input
                value={materialNameDraft}
                onChange={(e) => {
                  setMaterialNameDraft(e.target.value);
                  setMaterialFormError(null);
                }}
                placeholder="原料名"
              />
            </div>
            <div className="col-span-4">
              <Select
                value={materialUnitDraft}
                onValueChange={(value) => {
                  setMaterialUnitDraft(value as RecipeUnit);
                  setMaterialFormError(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="単位" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="kg">kg</SelectItem>
                  <SelectItem value="g">g</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Button onClick={onCreateMaterial} className="w-full">
                追加
              </Button>
            </div>
          </div>
          {materialFormError ? (
            <div className="text-sm text-destructive">{materialFormError}</div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">原料一覧</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {materialsMaster.length ? (
            <div className="divide-y rounded-lg border">
              <div className="grid grid-cols-12 gap-2 bg-muted/30 p-2 text-xs text-muted-foreground">
                <div className="col-span-6">原料名</div>
                <div className="col-span-2">単位</div>
                <div className="col-span-4 text-right">操作</div>
              </div>
              {materialsMaster.map((material) => {
                const isEditing = editingMaterialId === material.id;
                return (
                  <div key={material.id} className="grid grid-cols-12 items-center gap-2 p-2">
                    <div className="col-span-6">
                      {isEditing ? (
                        <Input
                          value={editingMaterialName}
                          onChange={(e) => {
                            setEditingMaterialName(e.target.value);
                            setMaterialFormError(null);
                          }}
                        />
                      ) : (
                        <div className="text-sm font-medium">{material.name}</div>
                      )}
                    </div>
                    <div className="col-span-2">
                      {isEditing ? (
                        <Select value={editingMaterialUnit} onValueChange={(value) => setEditingMaterialUnit(value as RecipeUnit)}>
                          <SelectTrigger>
                            <SelectValue placeholder="単位" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="kg">kg</SelectItem>
                            <SelectItem value="g">g</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-sm text-muted-foreground">{material.unit}</div>
                      )}
                    </div>
                    <div className="col-span-4 flex justify-end gap-2">
                      {isEditing ? (
                        <>
                          <Button variant="outline" onClick={onCancelEditMaterial}>
                            キャンセル
                          </Button>
                          <Button onClick={onSaveEditMaterial}>保存</Button>
                        </>
                      ) : (
                        <>
                          <Button variant="outline" onClick={() => onStartEditMaterial(material)}>
                            編集
                          </Button>
                          <Button variant="destructive" onClick={() => onDeleteMaterial(material.id)}>
                            削除
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              原料マスタが未登録です。上のフォームから追加してください。
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );

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
                activeView === "master" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => {
                setActiveView("master");
                setNavOpen(false);
              }}
            >
              マスタ管理
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
            <div className="text-base font-semibold">
              {activeView === "schedule" ? "スケジュール" : "マスタ管理"}
            </div>
          </div>
        </header>

        <main className="p-4">{activeView === "schedule" ? scheduleView : masterView}</main>

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
                          <Select
                            value={r.materialId}
                            onValueChange={(value) => {
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
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="原料を選択" />
                            </SelectTrigger>
                            <SelectContent>
                              {materialsMaster.length ? (
                                materialsMaster.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>
                                    {m.name}
                                  </SelectItem>
                                ))
                              ) : (
                                <SelectItem value="__none__" disabled>
                                  原料が未登録です
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
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
                              const unit = v === "g" ? "g" : "kg";
                              setRecipeDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, unit } : x)));
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="単位" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="kg">kg</SelectItem>
                              <SelectItem value="g">g</SelectItem>
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
                              unit: fallbackMaterial?.unit ?? "kg",
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
