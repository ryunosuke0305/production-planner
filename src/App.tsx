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

type RecipeLine = {
  material: string;
  perUnit: number;
  unit: RecipeUnit;
};

type Item = {
  id: string;
  name: string;
  unit: ItemUnit;
  stock: number;
  recipe: RecipeLine[];
};

type Block = {
  id: string;
  itemId: string;
  start: number;
  len: number;
  amount: number;
  memo: string;
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
    recipe: RecipeLine[];
  }>;
  blocks: Array<{
    id: string;
    itemId: string;
    start: number;
    len: number;
    startLabel: string;
    endLabel: string;
    amount: number;
    memo: string;
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
  items: Item[];
  blocks: Block[];
};

const SAMPLE_ITEMS: Item[] = [
  {
    id: "A",
    name: "Item A",
    unit: "cs",
    stock: 140,
    recipe: [
      { material: "原料A", perUnit: 0.25, unit: "kg" },
      { material: "原料B", perUnit: 0.5, unit: "kg" },
    ],
  },
  {
    id: "B",
    name: "Item B",
    unit: "cs",
    stock: 70,
    recipe: [
      { material: "原料A", perUnit: 0.1, unit: "kg" },
      { material: "原料C", perUnit: 0.2, unit: "kg" },
    ],
  },
  {
    id: "C",
    name: "Item C",
    unit: "kg",
    stock: 320,
    recipe: [
      { material: "原料D", perUnit: 0.35, unit: "kg" },
      { material: "原料E", perUnit: 0.05, unit: "kg" },
    ],
  },
];

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

function buildWeekDates(start: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(toISODate(d));
  }
  return out;
}

function calcMaterials(item: Item, amount: number): Array<{ material: string; qty: number; unit: RecipeUnit }> {
  return item.recipe.map((r) => ({
    material: r.material,
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
  { id: uid("b"), itemId: "A", start: 1, len: 2, amount: 40, memo: "" },
  { id: uid("b"), itemId: "B", start: 6, len: 2, amount: 30, memo: "段取り注意" },
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

function asItemUnit(value: unknown): ItemUnit {
  return value === "kg" ? "kg" : "cs";
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
      const recipe = Array.isArray(record.recipe)
        ? record.recipe
            .map((r) => {
              if (!r || typeof r !== "object") return null;
              const rRecord = r as Record<string, unknown>;
              const material = asString(rRecord.material).trim();
              if (!material) return null;
              return {
                material,
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
        recipe,
      } satisfies Item;
    })
    .filter((item): item is Item => item !== null);
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
      } satisfies Block;
    })
    .filter((block): block is Block => block !== null);
}

function parsePlanPayload(raw: unknown): PlanPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) return null;
  const weekStartISO = asString(record.weekStartISO).trim();
  if (!weekStartISO) return null;
  return {
    version: 1,
    weekStartISO,
    density: asDensity(record.density),
    items: sanitizeItems(record.items),
    blocks: sanitizeBlocks(record.blocks),
  };
}

function buildSlots(density: Density): number[] {
  if (density === "day") return [8];
  if (density === "2hour") return [8, 10, 12, 14, 16];
  return [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
}

const BASE_SLOTS_PER_DAY = buildSlots("hour").length;

function slotsPerDayForDensity(density: Density): number {
  return buildSlots(density).length;
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

function slotLabel(p: { density: Density; weekDates: string[]; hours: number[]; slotIndex: number }): string {
  const perDay = p.hours.length;
  const dayIdx = Math.floor(p.slotIndex / perDay);
  const hourIdx = p.slotIndex % perDay;
  const date = p.weekDates[dayIdx];
  const h = p.hours[hourIdx];
  if (!date) return "";
  return p.density === "day" ? `${toMD(date)}` : `${toMD(date)} ${h}:00`;
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
  weekDates: string[];
  hours: number[];
  slotsPerDay: number;
  slotCount: number;
  items: Item[];
  blocks: Block[];
}): ExportPayloadV1 {
  const slotIndexToLabel = new Array(p.slotCount).fill("").map((_, i) =>
    slotLabel({ density: p.density, weekDates: p.weekDates, hours: p.hours, slotIndex: i })
  );

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
      weekDates: p.weekDates,
      hours: p.hours,
      slotIndexToLabel,
    },
    items: p.items.map((it) => ({
      id: it.id,
      name: it.name,
      unit: it.unit,
      stock: it.stock,
      recipe: it.recipe.map((r) => ({ ...r })),
    })),
    blocks: p.blocks.map((b) => ({
      id: b.id,
      itemId: b.itemId,
      start: b.start,
      len: b.len,
      startLabel: slotLabel({ density: p.density, weekDates: p.weekDates, hours: p.hours, slotIndex: b.start }),
      endLabel: slotLabel({
        density: p.density,
        weekDates: p.weekDates,
        hours: p.hours,
        slotIndex: Math.min(p.slotCount - 1, b.start + b.len - 1),
      }),
      amount: b.amount,
      memo: b.memo,
    })),
    constraints: {},
  };
}

// ---------------------------------------------------------------------
// 簡易テスト（開発時のみ）
// - 既存テストは維持し、追加テストを増やす
// ---------------------------------------------------------------------
(function devTests() {
  // eslint-disable-next-line no-console
  console.assert(durationLabel(1, "hour") === "1時間", "durationLabel hour");
  // eslint-disable-next-line no-console
  console.assert(durationLabel(2, "hour") === "2時間", "durationLabel hour x2");
  // eslint-disable-next-line no-console
  console.assert(durationLabel(1, "2hour") === "2時間", "durationLabel 2hour");
  // eslint-disable-next-line no-console
  console.assert(durationLabel(2, "2hour") === "4時間", "durationLabel 2hour x2");
  // eslint-disable-next-line no-console
  console.assert(durationLabel(1, "day") === "1日", "durationLabel day");

  // 追加テスト：クランプ
  // eslint-disable-next-line no-console
  console.assert(clamp(5, 0, 3) === 3, "clamp upper");
  // eslint-disable-next-line no-console
  console.assert(clamp(-1, 0, 3) === 0, "clamp lower");

  // export payload shape (minimum)
  const dummy: ExportPayloadV1 = {
    schemaVersion: "1.0.0",
    meta: {
      exportedAtISO: "2026-01-14T00:00:00.000Z",
      timezone: "Asia/Tokyo",
      weekStartISO: "2026-01-12",
      horizonDays: 7,
      density: "hour",
      slotsPerDay: 10,
      slotCount: 70,
      weekDates: [],
      hours: [],
      slotIndexToLabel: [],
    },
    items: [],
    blocks: [],
    constraints: {},
  };
  // eslint-disable-next-line no-console
  console.assert(typeof dummy.schemaVersion === "string", "export schemaVersion");
  // eslint-disable-next-line no-console
  console.assert(typeof dummy.meta.weekStartISO === "string", "export meta.weekStartISO");
})();

type DragKind = "move" | "resizeL" | "resizeR";

type DragState = {
  kind: DragKind;
  blockId: string;
  originStart: number;
  originLen: number;
  laneRect: { left: number; width: number };
  itemId: string;
  moved: boolean;
};

export default function ManufacturingPlanGanttApp(): JSX.Element {
  const [planWeekStart, setPlanWeekStart] = useState<Date>(() => getDefaultWeekStart());
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => getDefaultWeekStart());

  const [planDensity, setPlanDensity] = useState<Density>("hour");
  const [viewDensity, setViewDensity] = useState<Density>("hour");

  // 実運用ではユーザー設定から取得する想定
  const timezone = "Asia/Tokyo";

  const [items, setItems] = useState<Item[]>(SAMPLE_ITEMS);

  const weekDates = useMemo(() => buildWeekDates(viewWeekStart), [viewWeekStart]);
  const hours = useMemo(() => buildSlots(viewDensity), [viewDensity]);
  const slotsPerDay = hours.length;
  const slotCount = weekDates.length * slotsPerDay;

  const planWeekDates = useMemo(() => buildWeekDates(planWeekStart), [planWeekStart]);
  const planHours = useMemo(() => buildSlots(planDensity), [planDensity]);
  const planSlotsPerDay = planHours.length;
  const planSlotCount = planWeekDates.length * planSlotsPerDay;
  const planSlotIndexToLabel = useMemo(
    () =>
      Array.from({ length: planSlotCount }, (_, i) =>
        slotLabel({ density: planDensity, weekDates: planWeekDates, hours: planHours, slotIndex: i })
      ),
    [planDensity, planHours, planSlotCount, planWeekDates]
  );

  const isPlanWeekView = toISODate(viewWeekStart) === toISODate(planWeekStart);

  const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
  const geminiModel = (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ?? "gemini-1.5-flash";

  const [blocks, setBlocks] = useState<Block[]>(() => DEFAULT_BLOCKS());

  const [isPlanLoaded, setIsPlanLoaded] = useState(false);

  const [openPlan, setOpenPlan] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [formAmount, setFormAmount] = useState("0");
  const [formMemo, setFormMemo] = useState("");

  const [openRecipe, setOpenRecipe] = useState(false);
  const [activeRecipeItemId, setActiveRecipeItemId] = useState<string | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeLine[]>([]);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: uid("chat"),
      role: "assistant",
      content: "右のチャットから計画の変更指示を送ると、Geminiが計画を更新します。",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);

  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const activeBlock = useMemo(() => {
    if (!activeBlockId) return null;
    return blocks.find((b) => b.id === activeBlockId) ?? null;
  }, [activeBlockId, blocks]);

  const activeItem = useMemo(() => {
    if (!activeBlock) return null;
    return items.find((x) => x.id === activeBlock.itemId) ?? null;
  }, [activeBlock, items]);

  const materials = useMemo(() => {
    if (!activeItem) return [];
    const amount = Math.max(0, safeNumber(formAmount));
    return calcMaterials(activeItem, amount);
  }, [activeItem, formAmount]);

  const activeRecipeItem = useMemo(() => {
    if (!activeRecipeItemId) return null;
    return items.find((x) => x.id === activeRecipeItemId) ?? null;
  }, [activeRecipeItemId, items]);

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
        if (!Number.isNaN(parsedWeekStart.getTime())) {
          parsedWeekStart.setHours(0, 0, 0, 0);
          setPlanWeekStart(parsedWeekStart);
          setViewWeekStart(parsedWeekStart);
        }
        setPlanDensity(payload.density);
        setViewDensity(payload.density);
        setItems(payload.items.length ? payload.items : SAMPLE_ITEMS);
        setBlocks(payload.blocks.length ? payload.blocks : DEFAULT_BLOCKS());
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
        await fetch("/api/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version: 1,
            weekStartISO: toISODate(planWeekStart),
            density: planDensity,
            items,
            blocks,
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
  }, [blocks, isPlanLoaded, items, planDensity, planWeekStart]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, chatBusy]);

  const buildPlanContext = () => {
    const blockSummaries = blocks.map((b) => ({
      id: b.id,
      itemId: b.itemId,
      itemName: items.find((x) => x.id === b.itemId)?.name ?? "",
      startSlot: b.start,
      startLabel: slotLabel({ density: planDensity, weekDates: planWeekDates, hours: planHours, slotIndex: b.start }),
      len: b.len,
      amount: b.amount,
      memo: b.memo,
    }));

    return JSON.stringify(
      {
        weekStartISO: planWeekDates[0],
        density: planDensity,
        slotsPerDay: planSlotsPerDay,
        slotCount: planSlotCount,
        slotIndexToLabel: planSlotIndexToLabel,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          unit: item.unit,
          stock: item.stock,
          recipe: item.recipe,
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
          };
          next = [...next, resolveOverlap(candidate, next)];
        }

        if (action.type === "update_block") {
          const targetId = resolveBlockId(action, next);
          if (!targetId) return;
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
              },
              next
            );
          });
        }

        if (action.type === "delete_block") {
          const targetId = resolveBlockId(action, next);
          if (!targetId) return;
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

    if (!geminiApiKey) {
      setChatMessages((prev) => [
        ...prev,
        { id: uid("chat"), role: "assistant", content: "APIキーが未設定です。.envに設定してください。" },
      ]);
      setChatBusy(false);
      return;
    }

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
      "ユーザーが「空いてるところ」「空き枠」「この日までに」などの曖昧な指示を出した場合は、blocksの重複を避けつつ、条件に合う最も早いスロットを選んでstartSlotを必ず指定してください。",
    ].join("\n");

    const planContext = buildPlanContext();
    const messageWithContext = `${trimmed}\n\n現在の計画データ(JSON):\n${planContext}`;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          geminiModel
        )}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
            contents: [
              ...chatMessages.map((msg) => ({
                role: msg.role === "assistant" ? "model" : "user",
                parts: [{ text: msg.content }],
              })),
              { role: "user", parts: [{ text: messageWithContext }] },
            ],
          }),
        }
      );

      if (!response.ok) {
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

      setChatMessages((prev) => [
        ...prev,
        { id: uid("chat"), role: "assistant", content: assistantContent.trim() || "更新しました。" },
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gemini API呼び出しに失敗しました。";
      setChatError(message);
      setChatMessages((prev) => [
        ...prev,
        { id: uid("chat"), role: "assistant", content: "API呼び出しでエラーが発生しました。" },
      ]);
    } finally {
      setChatBusy(false);
    }
  };

  const openPlanEdit = (block: Block) => {
    setActiveBlockId(block.id);
    setFormAmount(String(block.amount ?? 0));
    setFormMemo(block.memo ?? "");
    setOpenPlan(true);
  };

  const onPlanSave = () => {
    if (!activeBlockId) return;
    const amount = Math.max(0, safeNumber(formAmount));
    setBlocks((prev) => prev.map((b) => (b.id === activeBlockId ? { ...b, amount, memo: formMemo } : b)));
    setOpenPlan(false);
  };

  const onPlanDelete = () => {
    if (!activeBlockId) return;
    setBlocks((prev) => prev.filter((b) => b.id !== activeBlockId));
    setOpenPlan(false);
  };

  const createBlockAt = (itemId: string, slot: number) => {
    if (!isPlanWeekView) return;
    const planSlot = clamp(convertSlotIndex(slot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const b: Block = {
      id: uid("b"),
      itemId,
      start: planSlot,
      len: 1,
      amount: 0,
      memo: "",
    };
    setBlocks((prev) => [...prev, b]);
    openPlanEdit(b);
  };

  const resolveOverlap = (candidate: Block, allBlocks: Block[]): Block => {
    const sameLane = allBlocks
      .filter((x) => x.itemId === candidate.itemId && x.id !== candidate.id)
      .sort((a, b) => a.start - b.start);

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

  const beginPointer = (p: { kind: DragKind; blockId: string; itemId: string; clientX: number }) => {
    if (!isPlanWeekView) return;
    const laneEl = laneRefs.current[p.itemId];
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
      itemId: p.itemId,
      moved: false,
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = dragStateRef.current;
    if (!s) return;

    const slot = xToSlot(e.clientX, s.laneRect, slotCount);
    const planSlot = clamp(convertSlotIndex(slot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const planSlotEnd = clamp(convertSlotIndex(slot + 1, viewDensity, planDensity, "ceil"), 1, planSlotCount);
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
  }, [planDensity, planSlotCount, slotCount, viewDensity]);

  const openRecipeEdit = (itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    setActiveRecipeItemId(itemId);
    setRecipeDraft(it.recipe.map((r) => ({ ...r })));
    setOpenRecipe(true);
  };

  const onRecipeSave = () => {
    if (!activeRecipeItemId) return;
    setItems((prev) =>
      prev.map((it) =>
        it.id === activeRecipeItemId
          ? {
              ...it,
              recipe: recipeDraft
                .map((r) => ({
                  material: (r.material ?? "").trim(),
                  perUnit: Number.isFinite(Number(r.perUnit)) ? Number(r.perUnit) : 0,
                  unit: r.unit === "g" ? "g" : "kg",
                }))
                .filter((r) => r.material.length > 0),
            }
          : it
      )
    );
    setOpenRecipe(false);
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

  // JSONエクスポート
  const exportPlanAsJson = () => {
    const exportWeekDates = buildWeekDates(planWeekStart);
    const exportHours = buildSlots(planDensity);
    const exportSlotsPerDay = exportHours.length;
    const exportSlotCount = exportWeekDates.length * exportSlotsPerDay;
    const payload = buildExportPayload({
      weekStart: planWeekStart,
      timezone,
      density: planDensity,
      weekDates: exportWeekDates,
      hours: exportHours,
      slotsPerDay: exportSlotsPerDay,
      slotCount: exportSlotCount,
      items,
      blocks,
    });

    const json = JSON.stringify(payload, null, 2);
    const filename = `manufacturing_plan_${payload.meta.weekStartISO}_${planDensity}.json`;
    downloadTextFile(filename, json, "application/json");
  };

  // 表示上の列幅
  const colW = viewDensity === "day" ? 120 : 72;
  const dateSpan = hours.length;

  // 日区切り強調用：背景
  const dayW = colW * slotsPerDay;
  const slotGridBg = `repeating-linear-gradient(to right, transparent 0, transparent ${
    colW - 1
  }px, rgba(148, 163, 184, 0.4) ${colW - 1}px, rgba(148, 163, 184, 0.4) ${colW}px)`;
  const daySeparatorBg = `repeating-linear-gradient(to right, transparent 0, transparent ${
    dayW - 2
  }px, rgba(71, 85, 105, 0.55) ${dayW - 2}px, rgba(71, 85, 105, 0.55) ${dayW}px)`;

  return (
    <div className="min-h-screen w-full bg-background p-4 text-foreground">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="text-2xl font-semibold tracking-tight">製造計画（ガントチャート）</div>
              <div className="text-sm text-muted-foreground">
                バーをドラッグで移動、左右ハンドルで幅調整できます。空白クリックで新規作成します。
              </div>
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

          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">
                週表示：{toMD(weekDates[0])} 〜 {toMD(weekDates[6])}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
                <div
                  className="min-w-[1100px] text-slate-900"
                  style={{
                    display: "grid",
                    gridTemplateColumns: `260px 110px repeat(${slotCount}, ${colW}px)`,
                  }}
                >
                {/* ヘッダ（上段：日付） */}
                <div className="sticky left-0 top-0 z-50 bg-white border-b border-r p-3 font-medium">品目</div>
                <div className="sticky top-0 z-20 bg-white border-b border-r p-3 text-center font-medium">Stock</div>
                {weekDates.map((date, i) => (
                  <div
                    key={`date-${date}`}
                    className={
                      "sticky top-0 z-20 bg-white border-b p-3 text-center font-medium" +
                      (i < 6 ? " border-r" : "")
                    }
                    style={{ gridColumn: `span ${dateSpan}` }}
                  >
                    <div className="text-sm font-semibold">{toMD(date)}</div>
                    <div className="text-xs text-muted-foreground">({toWeekday(date)})</div>
                  </div>
                ))}

                {/* ヘッダ（下段：時間） */}
                <div className="sticky left-0 top-[49px] z-50 bg-white border-b border-r p-2 text-xs text-muted-foreground" />
                <div className="sticky top-[49px] z-20 bg-white border-b border-r p-2 text-xs text-muted-foreground" />
                {weekDates.flatMap((date, dayIdx) =>
                  hours.map((h, hourIdx) => (
                    <div
                      key={`hour-${date}-${h}`}
                      className={
                        "sticky top-[49px] z-20 bg-white border-b p-2 text-center text-xs text-muted-foreground" +
                        (hourIdx === hours.length - 1 && dayIdx < 6 ? " border-r" : "")
                      }
                    >
                      {viewDensity === "day" ? "" : `${h}`}
                    </div>
                  ))
                )}

                {/* 行（品目） */}
                {items.map((item) => {
                  const laneBlocks = (isPlanWeekView ? blocks : [])
                    .filter((b) => b.itemId === item.id)
                    .sort((a, b) => a.start - b.start);

                  const eod = eodStockByItem[item.id] ?? new Array(7).fill(item.stock);

                  return (
                    <React.Fragment key={item.id}>
                      {/* 左：品目（クリックでレシピモーダル） */}
                      <div className="sticky left-0 z-40 bg-white border-b border-r p-3">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="text-left font-medium underline-offset-4 hover:underline"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openRecipeEdit(item.id);
                            }}
                          >
                            {item.name}
                          </button>
                          <Badge variant="secondary">{item.unit}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">レシピ {item.recipe.length}件</div>
                      </div>

                      {/* 中：開始在庫 */}
                      <div className="bg-white border-b border-r p-3 text-right">
                        <div className="font-medium">{item.stock}</div>
                        <div className="text-xs text-muted-foreground">開始在庫</div>
                      </div>

                      {/* 右：レーン */}
                      <div
                        className="relative border-b overflow-hidden"
                        style={{ gridColumn: `span ${slotCount}`, height: 64 }}
                        ref={(el) => {
                          laneRefs.current[item.id] = el;
                        }}
                        onClick={(e) => {
                          if (suppressClickRef.current) return;
                          if (e.defaultPrevented) return;

                          const rect = e.currentTarget.getBoundingClientRect();
                          const slot = xToSlot(e.clientX, { left: rect.left, width: rect.width }, slotCount);
                          createBlockAt(item.id, slot);
                        }}
                      >
                        {/* 目盛線（スロット + 日境界） */}
                        <div
                          className="absolute inset-0"
                          style={{
                            backgroundImage: `${slotGridBg}, ${daySeparatorBg}`,
                            opacity: 0.8,
                          }}
                        />

                        {/* 日末在庫（EOD） */}
                        {weekDates.map((date, dayIdx) => {
                          const x = (dayIdx + 1) * dayW;
                          return (
                            <div
                              key={`eod-${item.id}-${date}`}
                              className="absolute bottom-[4px]"
                              style={{ left: x - 8, transform: "translateX(-100%)" }}
                            >
                              <div className="rounded-md border bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">
                                EOD {eod[dayIdx]}
                              </div>
                            </div>
                          );
                        })}

                        {/* ブロック */}
                        {laneBlocks.map((b) => {
                          const viewStart = clamp(convertSlotIndex(b.start, planDensity, viewDensity, "floor"), 0, slotCount - 1);
                          const viewLen = clamp(convertSlotLength(b.len, planDensity, viewDensity, "ceil"), 1, slotCount - viewStart);
                          const left = viewStart * colW;
                          const width = viewLen * colW;
                          const isActive = b.id === activeBlockId;

                          return (
                            <motion.div
                              key={b.id}
                              className={
                                "absolute top-[6px] h-[42px] rounded-xl border shadow-sm touch-none " +
                                (isActive
                                  ? " border-sky-400 bg-sky-200"
                                  : " border-sky-200 bg-sky-100 hover:bg-sky-200")
                              }
                              style={{ left, width }}
                              whileTap={{ scale: 0.99 }}
                              onClick={(ev) => {
                                if (suppressClickRef.current) return;
                                ev.preventDefault();
                                ev.stopPropagation();
                                openPlanEdit(b);
                              }}
                            >
                              {/* 左リサイズ */}
                              <div
                                className="absolute left-0 top-0 z-30 h-full w-2 cursor-ew-resize rounded-l-xl touch-none"
                                onPointerDown={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  beginPointer({ kind: "resizeL", blockId: b.id, itemId: item.id, clientX: ev.clientX });
                                }}
                                title="幅調整（左）"
                              />

                              {/* 右リサイズ */}
                              <div
                                className="absolute right-0 top-0 z-30 h-full w-2 cursor-ew-resize rounded-r-xl touch-none"
                                onPointerDown={(ev) => {
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  beginPointer({ kind: "resizeR", blockId: b.id, itemId: item.id, clientX: ev.clientX });
                                }}
                                title="幅調整（右）"
                              />

                              {/* 移動 */}
                              <div
                                className="absolute inset-0 z-10 cursor-grab select-none rounded-xl p-2 touch-none"
                                onPointerDown={(ev) => {
                                  const r = ev.currentTarget.getBoundingClientRect();
                                  const x = ev.clientX - r.left;
                                  if (x <= 8 || x >= r.width - 8) return;
                                  ev.preventDefault();
                                  ev.stopPropagation();
                                  beginPointer({ kind: "move", blockId: b.id, itemId: item.id, clientX: ev.clientX });
                                }}
                              >
                                <div className="flex h-full flex-col justify-between">
                                  <div className="flex items-center justify-between">
                                    <div className="text-[11px] text-slate-700">
                                      {slotLabel({
                                        density: planDensity,
                                        weekDates: planWeekDates,
                                        hours: planHours,
                                        slotIndex: b.start,
                                      })}
                                    </div>
                                    <div className="text-[11px] text-slate-700">
                                      {durationLabel(b.len, planDensity)}
                                    </div>
                                  </div>
                                  <div className="text-sm font-semibold">+{b.amount}</div>
                                  <div className="truncate text-[11px] text-slate-600">{b.memo || " "}</div>
                                </div>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    </React.Fragment>
                  );
                })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 計画編集モーダル */}
          <Dialog open={openPlan} onOpenChange={setOpenPlan}>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {activeItem ? activeItem.name : ""}
                  {activeBlock ? (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      {slotLabel({
                        density: planDensity,
                        weekDates: planWeekDates,
                        hours: planHours,
                        slotIndex: activeBlock.start,
                      })}
                      {activeBlock.len ? `（${durationLabel(activeBlock.len, planDensity)}）` : ""}
                    </span>
                  ) : null}
                </DialogTitle>
              </DialogHeader>

            <div className="space-y-5">
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
                      <div key={m.material} className="flex items-center justify-between">
                        <div className="text-sm">{m.material}</div>
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
                    <div className="flex items-center justify-between">
                      <div className="text-muted-foreground">現在のブロック</div>
                      <Badge variant="secondary">編集</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div>期間</div>
                      <div className="font-medium">
                        {slotLabel({
                          density: planDensity,
                          weekDates: planWeekDates,
                          hours: planHours,
                          slotIndex: activeBlock.start,
                        })}
                        <span className="mx-1 text-muted-foreground">→</span>
                        {slotLabel({
                          density: planDensity,
                          weekDates: planWeekDates,
                          hours: planHours,
                          slotIndex: Math.min(planSlotCount - 1, activeBlock.start + activeBlock.len - 1),
                        })}
                      </div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setOpenPlan(false)}>
                  キャンセル
                </Button>
                <Button variant="destructive" onClick={onPlanDelete}>
                  削除
                </Button>
                <Button onClick={onPlanSave}>保存</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* レシピ設定モーダル */}
          <Dialog open={openRecipe} onOpenChange={setOpenRecipe}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>レシピ設定{activeRecipeItem ? `：${activeRecipeItem.name}` : ""}</DialogTitle>
              </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-muted-foreground">
                係数は「製品1{activeRecipeItem?.unit ?? ""}あたりの原料量」です。
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
                    <div key={`${r.material}-${idx}`} className="grid grid-cols-12 items-center gap-2 p-2">
                      <div className="col-span-6">
                        <Input
                          value={r.material}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRecipeDraft((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, material: v } : x))
                            );
                          }}
                          placeholder="例：原料A"
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
                      onClick={() => setRecipeDraft((prev) => [...prev, { material: "", perUnit: 0, unit: "kg" }])}
                    >
                      追加
                    </Button>
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

        <div className="w-full shrink-0 lg:w-[360px]">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Gemini チャット</CardTitle>
            </CardHeader>
            <CardContent className="flex h-[640px] flex-col gap-3">
              <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                .envでVITE_GEMINI_API_KEYとVITE_GEMINI_MODELを設定してください。空き枠指定や期限指定の指示もOKです。
              </div>
              {!geminiApiKey ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  APIキーが未設定です。
                </div>
              ) : null}
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
        </div>
      </div>
    </div>
  );
}
