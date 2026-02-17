import type { Density, Item, Material, RecipeUnit } from "@/types/planning";

export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.[0-9]*?)0+$/, "$1");
}

export function durationLabel(len: number, density: Density): string {
  if (density === "day") return `${len}日`;
  if (density === "2hour") return `${len * 2}時間`;
  return `${len}時間`;
}

export function formatUpdatedAt(value: string | null): string {
  if (!value) return "未更新";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "未更新";
  return parsed.toLocaleString("ja-JP");
}

export function itemCodeKey(item: Item): string {
  return item.publicId;
}

export function calcMaterials(
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
