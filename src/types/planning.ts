export type Density = "hour" | "2hour" | "day";

export type ItemUnit = "ピース" | "ケース" | "セット" | "kg" | "袋" | "枚" | "個" | "箱";

export type RecipeUnit = ItemUnit;

export type PlanningPolicy = "make_to_order" | "make_to_stock";

export type Material = {
  id: string;
  name: string;
  unit: RecipeUnit;
};

export type RecipeLine = {
  materialId: string;
  perUnit: number;
  unit: RecipeUnit;
};

export type Item = {
  id: string;
  publicId?: string;
  name: string;
  unit: ItemUnit;
  planningPolicy: PlanningPolicy;
  safetyStock: number;
  safetyStockAutoEnabled: boolean;
  safetyStockLookbackDays: number;
  safetyStockCoefficient: number;
  shelfLifeDays: number;
  productionEfficiency: number;
  packagingEfficiency: number;
  notes: string;
  recipe: RecipeLine[];
};

export type CalendarDay = {
  date: string;
  isHoliday: boolean;
  workStartHour: number;
  workEndHour: number;
};

export type Block = {
  id: string;
  itemId: string;
  start: number;
  len: number;
  amount: number;
  memo: string;
  approved: boolean;
  createdBy?: string;
  updatedBy?: string;
  startAt?: string;
  endAt?: string;
};

export type ExportPayloadV1 = {
  schemaVersion: "1.2.3";
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
    safetyStockAutoEnabled: boolean;
    safetyStockLookbackDays: number;
    safetyStockCoefficient: number;
    shelfLifeDays: number;
    productionEfficiency: number;
    packagingEfficiency: number;
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
    shipped: number;
  }>;
  eodStocks: Array<{
    itemCode: string;
    dates: string[];
    stocks: number[];
  }>;
  constraints: Record<string, unknown>;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt?: string;
};

export type ChatAction = {
  type: "create_block" | "update_block" | "delete_block";
  blockId?: string;
  itemId?: string;
  startSlot?: number;
  startLabel?: string;
  len?: number;
  amount?: number;
  memo?: string;
};

export type ChatResponsePayload = {
  summary?: string;
  actions?: ChatAction[];
};

export type AuthRole = "admin" | "requester" | "viewer";

export type AuthUser = {
  id: string;
  name: string;
  role: AuthRole;
};

export type ManagedUser = {
  id: string;
  name: string;
  role: AuthRole;
};

export type PlanPayload = {
  version: 1;
  weekStartISO: string;
  density: Density;
  calendarDays: CalendarDay[];
  materials: Material[];
  items: Item[];
  blocks: Block[];
};

export type DailyStockEntry = {
  date: string;
  itemId: string;
  itemCode: string;
  stock: number;
  shipped: number;
};

export type DailyStocksResponse = {
  updatedAtISO: string | null;
  entries: DailyStockEntry[];
};

export type ImportHeaderOverrides = {
  dailyStock: {
    date: string;
    itemCode: string;
    stock: string;
    shipped: string;
  };
};

export type InfoTooltipProps = {
  text: string;
};

export type ItemImportRow = {
  code: string;
  name: string;
  unit: ItemUnit;
  planningPolicy: PlanningPolicy;
  safetyStock: number;
  safetyStockAutoEnabled: boolean | null;
  safetyStockLookbackDays: number | null;
  safetyStockCoefficient: number | null;
  shelfLifeDays: number;
  productionEfficiency: number;
  packagingEfficiency: number | null;
  notes: string;
};

export type MaterialImportRow = {
  code: string;
  name: string;
  unit: RecipeUnit;
};

export type CalendarSlots = {
  rawHoursByDay: number[][];
  hoursByDay: Array<Array<number | null>>;
  slotsPerDay: number;
  slotCount: number;
};

export type PlanSnapshot = {
  calendarDays: CalendarDay[];
  calendarSlots: CalendarSlots;
  slotIndexToLabel: string[];
  slotCount: number;
};

export type DragKind = "move" | "resizeL" | "resizeR";

export type DragState = {
  kind: DragKind;
  blockId: string;
  originStart: number;
  originLen: number;
  pointerOffset: number;
  laneRect: { left: number; width: number };
  dayIndex: number;
  moved: boolean;
};
