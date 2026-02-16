import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_ITEM_UNIT,
  DEFAULT_PACKAGING_EFFICIENCY,
  DEFAULT_SAFETY_STOCK_COEFFICIENT,
  DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS,
  ITEM_UNITS,
} from "@/constants/planning";
import type { Item, ItemUnit, PlanningPolicy } from "@/types/planning";

export type ItemDialogMode = "create" | "edit";

export interface ItemDialogValues {
  name: string;
  publicId: string;
  unit: ItemUnit;
  planningPolicy: PlanningPolicy;
  safetyStock: string;
  safetyStockAutoEnabled: boolean;
  safetyStockLookbackDays: string;
  safetyStockCoefficient: string;
  shelfLifeDays: string;
  productionEfficiency: string;
  packagingEfficiency: string;
  notes: string;
}

export type ItemDialogCommitPayload =
  | {
      action: "create";
      values: ItemDialogValues;
    }
  | {
      action: "update";
      itemId: string;
      values: ItemDialogValues;
    }
  | {
      action: "delete";
      itemId: string;
    };

interface ItemDialogModel {
  open: boolean;
  mode: ItemDialogMode;
  editingItemId: string | null;
  items: Item[];
  modalWideClassName: string;
  modalBodyClassName: string;
  canEdit: boolean;
}

interface ItemDialogProps {
  dialogModel: ItemDialogModel;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: ItemDialogCommitPayload) => boolean;
}

const defaultValues: ItemDialogValues = {
  name: "",
  publicId: "",
  unit: DEFAULT_ITEM_UNIT,
  planningPolicy: "make_to_stock",
  safetyStock: "0",
  safetyStockAutoEnabled: false,
  safetyStockLookbackDays: String(DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS),
  safetyStockCoefficient: String(DEFAULT_SAFETY_STOCK_COEFFICIENT),
  shelfLifeDays: "0",
  productionEfficiency: "0",
  packagingEfficiency: String(DEFAULT_PACKAGING_EFFICIENCY),
  notes: "",
};

export function ItemDialog({ dialogModel, onOpenChange, onSave }: ItemDialogProps): JSX.Element {
  const [formValues, setFormValues] = useState<ItemDialogValues>(defaultValues);
  const [itemFormError, setItemFormError] = useState<string | null>(null);

  const editingItem = useMemo(
    () =>
      dialogModel.mode === "edit" && dialogModel.editingItemId
        ? dialogModel.items.find((item) => item.id === dialogModel.editingItemId) ?? null
        : null,
    [dialogModel.editingItemId, dialogModel.items, dialogModel.mode]
  );

  useEffect(() => {
    if (!dialogModel.open) return;
    if (dialogModel.mode === "create") {
      setFormValues(defaultValues);
      setItemFormError(null);
      return;
    }
    if (editingItem) {
      setFormValues({
        name: editingItem.name,
        publicId: editingItem.publicId ?? "",
        unit: editingItem.unit,
        planningPolicy: editingItem.planningPolicy ?? "make_to_stock",
        safetyStock: String(editingItem.safetyStock ?? 0),
        safetyStockAutoEnabled: editingItem.safetyStockAutoEnabled ?? false,
        safetyStockLookbackDays: String(
          editingItem.safetyStockLookbackDays ?? DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS
        ),
        safetyStockCoefficient: String(
          editingItem.safetyStockCoefficient ?? DEFAULT_SAFETY_STOCK_COEFFICIENT
        ),
        shelfLifeDays: String(editingItem.shelfLifeDays ?? 0),
        productionEfficiency: String(editingItem.productionEfficiency ?? 0),
        packagingEfficiency: String(editingItem.packagingEfficiency ?? DEFAULT_PACKAGING_EFFICIENCY),
        notes: editingItem.notes ?? "",
      });
      setItemFormError(null);
    } else {
      setFormValues(defaultValues);
      setItemFormError(null);
    }
  }, [dialogModel.mode, dialogModel.open, editingItem]);

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setItemFormError(null);
    }
  };

  const handleDelete = () => {
    if (!editingItem) return;
    const confirmed = window.confirm(`${editingItem.name} を削除しますか？`);
    if (!confirmed) return;
    const didDelete = onSave({ action: "delete", itemId: editingItem.id });
    if (didDelete) {
      onOpenChange(false);
    }
  };

  const handleSave = () => {
    const isEditMode = dialogModel.mode === "edit";
    const nextName = formValues.name.trim();
    const nextPublicId = formValues.publicId.trim();
    if (!nextName) {
      setItemFormError("品目名を入力してください。");
      return;
    }
    if (
      dialogModel.items.some(
        (item) => item.name === nextName && (!isEditMode || item.id !== dialogModel.editingItemId)
      )
    ) {
      setItemFormError("同じ品目名がすでに登録されています。");
      return;
    }
    if (
      nextPublicId &&
      dialogModel.items.some(
        (item) =>
          item.id !== dialogModel.editingItemId &&
          (item.id === nextPublicId || (item.publicId ?? "").trim() === nextPublicId)
      )
    ) {
      setItemFormError("同じ品目コードがすでに登録されています。");
      return;
    }
    const nextValues = {
      ...formValues,
      name: nextName,
      publicId: nextPublicId,
    } satisfies ItemDialogValues;

    let didSave = false;
    if (isEditMode) {
      if (!dialogModel.editingItemId) {
        return;
      }
      didSave = onSave({
        action: "update",
        itemId: dialogModel.editingItemId,
        values: nextValues,
      } satisfies ItemDialogCommitPayload);
    } else {
      didSave = onSave({
        action: "create",
        values: nextValues,
      } satisfies ItemDialogCommitPayload);
    }
    if (didSave) {
      onOpenChange(false);
    }
  };

  const itemEfficiencyUnit = formValues.unit;

  return (
    <Dialog open={dialogModel.open} onOpenChange={handleOpenChange}>
      <DialogContent className={dialogModel.modalWideClassName}>
        <DialogHeader>
          <DialogTitle>{dialogModel.mode === "edit" ? "品目を編集" : "品目を追加"}</DialogTitle>
        </DialogHeader>

        <div className={dialogModel.modalBodyClassName}>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
              <div className="text-sm font-medium text-muted-foreground">品目名</div>
              <Input
                value={formValues.name}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormValues((prev) => ({ ...prev, name: next }));
                  setItemFormError(null);
                }}
                placeholder="品目名"
              />
              <div className="text-sm font-medium text-muted-foreground">品目コード</div>
              <Input
                value={formValues.publicId}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormValues((prev) => ({ ...prev, publicId: next }));
                  setItemFormError(null);
                }}
                placeholder="品目コード"
              />
              <div className="text-sm font-medium text-muted-foreground">単位</div>
              <Select
                value={formValues.unit}
                onValueChange={(value) => {
                  setFormValues((prev) => ({ ...prev, unit: value as ItemUnit }));
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
                value={formValues.planningPolicy}
                onValueChange={(value) => {
                  setFormValues((prev) => ({ ...prev, planningPolicy: value as PlanningPolicy }));
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
                value={formValues.safetyStock}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormValues((prev) => ({ ...prev, safetyStock: next }));
                  setItemFormError(null);
                }}
                placeholder="安全在庫"
              />
              <div className="text-sm font-medium text-muted-foreground">安全在庫 自動計算</div>
              <Select
                value={formValues.safetyStockAutoEnabled ? "enabled" : "disabled"}
                onValueChange={(value) => {
                  const enabled = value === "enabled";
                  setFormValues((prev) => ({ ...prev, safetyStockAutoEnabled: enabled }));
                  setItemFormError(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="自動計算対象" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enabled">対象</SelectItem>
                  <SelectItem value="disabled">対象外</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-sm font-medium text-muted-foreground">安全在庫 参照日数</div>
              <Input
                inputMode="numeric"
                value={formValues.safetyStockLookbackDays}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormValues((prev) => ({ ...prev, safetyStockLookbackDays: next }));
                  setItemFormError(null);
                }}
                placeholder="例: 14"
              />
              <div className="text-sm font-medium text-muted-foreground">安全在庫 係数</div>
              <Input
                inputMode="decimal"
                value={formValues.safetyStockCoefficient}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormValues((prev) => ({ ...prev, safetyStockCoefficient: next }));
                  setItemFormError(null);
                }}
                placeholder="例: 1.1"
              />
              <div className="text-sm font-medium text-muted-foreground">賞味期限（日数）</div>
              <Input
                inputMode="decimal"
                value={formValues.shelfLifeDays}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormValues((prev) => ({ ...prev, shelfLifeDays: next }));
                  setItemFormError(null);
                }}
                placeholder="賞味期限（日数）"
              />
              <div className="text-sm font-medium text-muted-foreground">製造効率</div>
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  inputMode="decimal"
                  value={formValues.productionEfficiency}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFormValues((prev) => ({ ...prev, productionEfficiency: next }));
                    setItemFormError(null);
                  }}
                  placeholder="1人1時間あたりの製造数量"
                />
                <span className="text-xs text-muted-foreground">{itemEfficiencyUnit}/人時</span>
              </div>
              <div className="text-sm font-medium text-muted-foreground">包装効率</div>
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  inputMode="decimal"
                  value={formValues.packagingEfficiency}
                  onChange={(e) => {
                    const next = e.target.value;
                    setFormValues((prev) => ({ ...prev, packagingEfficiency: next }));
                    setItemFormError(null);
                  }}
                  placeholder="1人1時間あたりの包装数量"
                />
                <span className="text-xs text-muted-foreground">{itemEfficiencyUnit}/人時</span>
              </div>
              <div className="text-sm font-medium text-muted-foreground">備考</div>
              <Textarea
                value={formValues.notes}
                onChange={(e) => {
                  const next = e.target.value;
                  setFormValues((prev) => ({ ...prev, notes: next }));
                  setItemFormError(null);
                }}
                placeholder="自由記入（長文可）"
              />
            </div>
            {itemFormError ? <div className="mt-4 text-sm text-destructive">{itemFormError}</div> : null}
          </div>
        </div>

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            キャンセル
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {dialogModel.mode === "edit" ? (
              <Button variant="destructive" onClick={handleDelete} disabled={!dialogModel.canEdit}>
                削除
              </Button>
            ) : null}
            <Button onClick={handleSave} disabled={!dialogModel.canEdit}>
              {dialogModel.mode === "edit" ? "保存" : "追加"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
