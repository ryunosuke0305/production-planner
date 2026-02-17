import type { ImportHeaderOverrides, Item, ItemUnit, Material, PlanningPolicy, RecipeUnit } from "@/types/planning";

export const ITEM_UNITS = ["ピース", "ケース", "セット", "kg", "袋", "枚", "個", "箱"] as const;

export const DEFAULT_ITEM_UNIT: ItemUnit = ITEM_UNITS[0];
export const DEFAULT_MATERIAL_UNIT: RecipeUnit = "kg";
export const DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS = 7;
export const DEFAULT_SAFETY_STOCK_COEFFICIENT = 1;
export const DEFAULT_PACKAGING_EFFICIENCY = 1;
export const DEFAULT_TIMEZONE = "Asia/Tokyo";
export const JST_OFFSET_MINUTES = 9 * 60;
export const MS_PER_MINUTE = 60 * 1000;

export const DEFAULT_WORK_START_HOUR = 8;
export const DEFAULT_WORK_END_HOUR = 18;
export const DAYS_IN_WEEK = 7;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const DEFAULT_IMPORT_HEADER_OVERRIDES: ImportHeaderOverrides = {
  dailyStock: {
    date: "",
    itemCode: "",
    stock: "",
    shipped: "",
  },
};

export const SAMPLE_MATERIALS: Material[] = [
  { id: "MAT-A", name: "原料A", unit: "kg" },
  { id: "MAT-B", name: "原料B", unit: "kg" },
  { id: "MAT-C", name: "原料C", unit: "kg" },
  { id: "MAT-D", name: "原料D", unit: "kg" },
  { id: "MAT-E", name: "原料E", unit: "kg" },
];

export const SAMPLE_ITEMS: Item[] = [
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

export const PLANNING_POLICY_LABELS: Record<PlanningPolicy, string> = {
  make_to_order: "受注生産",
  make_to_stock: "見込生産",
};

export const DAILY_STOCK_HEADERS = {
  date: ["日付", "年月日", "date", "stockdate", "inventorydate"],
  itemCode: ["品目コード", "品目", "itemcode", "item_code", "itemid", "item_id"],
  stock: ["在庫数", "在庫", "stock", "inventory", "qty"],
  shipped: ["出荷数", "出荷", "shipped", "shipment", "shipqty", "ship_qty"],
};

export const ITEM_HEADERS = {
  code: ["品目コード", "コード", "itemcode", "item_code", "itemid", "item_id"],
  name: ["品目名", "品名", "name", "itemname", "item_name"],
  unit: ["単位", "unit"],
  planningPolicy: ["計画方針", "方針", "planningpolicy", "planning_policy", "policy"],
  safetyStock: ["安全在庫", "安全在庫数", "safetystock", "safety_stock"],
  safetyStockAutoEnabled: [
    "安全在庫自動計算",
    "安全在庫自動計算対象",
    "自動計算対象",
    "安全在庫自動",
    "auto_safety_stock",
    "safety_stock_auto",
    "safety_stock_auto_enabled",
  ],
  safetyStockLookbackDays: [
    "安全在庫参照日数",
    "参照日数",
    "安全在庫日数",
    "safetystockdays",
    "safety_stock_days",
    "lookbackdays",
    "lookback_days",
  ],
  safetyStockCoefficient: [
    "安全在庫係数",
    "係数",
    "safetystockcoefficient",
    "safety_stock_coefficient",
    "coefficient",
    "multiplier",
  ],
  shelfLifeDays: ["賞味期限", "賞味期限日数", "shelflifedays", "shelf_life_days", "expirationdays"],
  productionEfficiency: ["製造効率", "生産効率", "efficiency", "productionefficiency", "production_efficiency"],
  packagingEfficiency: ["包装効率", "packagingefficiency", "packaging_efficiency", "pack_efficiency"],
  notes: ["備考", "メモ", "notes", "note", "memo", "remark", "remarks"],
};

export const MATERIAL_HEADERS = {
  code: ["原料コード", "コード", "materialcode", "material_code", "materialid", "material_id"],
  name: ["原料名", "名称", "name", "material", "materialname", "material_name"],
  unit: ["単位", "unit"],
};

export const DAILY_STOCK_EXPORT_HEADERS = ["日付", "品目コード", "在庫数", "出荷数"];
export const ITEM_MASTER_EXPORT_HEADERS = [
  "品目コード",
  "品目名",
  "単位",
  "計画方針",
  "安全在庫",
  "安全在庫自動計算",
  "安全在庫参照日数",
  "安全在庫係数",
  "賞味期限日数",
  "製造効率",
  "包装効率",
  "備考",
];
export const MATERIAL_MASTER_EXPORT_HEADERS = ["原料コード", "原料名", "単位"];

export const BASE_SLOTS_PER_DAY = DEFAULT_WORK_END_HOUR - DEFAULT_WORK_START_HOUR;
