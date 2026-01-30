import React from "react";
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
import {
  SearchableCombobox,
  type SearchableOption,
} from "@/components/ui/searchable-combobox";
import { DEFAULT_MATERIAL_UNIT, ITEM_UNITS } from "@/constants/planning";
import {
  BlockDetailDialog,
  type BlockDetailDialogActions,
  type BlockDetailDialogModel,
} from "@/features/manufacturing/components/dialogs/BlockDetailDialog";
import {
  ConditionsDialog,
  type ConditionsDialogActions,
  type ConditionsDialogModel,
} from "@/features/manufacturing/components/dialogs/ConditionsDialog";
import { ItemDialog, type ItemDialogCommitPayload } from "@/features/manufacturing/components/dialogs/ItemDialog";
import { MaterialDialog } from "@/features/manufacturing/components/dialogs/MaterialDialog";
import { UserDialog } from "@/features/manufacturing/components/dialogs/UserDialog";
import { asRecipeUnit, safeNumber } from "@/lib/sanitize";
import type { Material, RecipeLine } from "@/types/planning";

type ManufacturingPlanDialogsProps = {
  userDialogModel: React.ComponentProps<typeof UserDialog>["dialogModel"];
  onUserDialogOpenChange: React.ComponentProps<typeof UserDialog>["onOpenChange"];
  onUserCreate: React.ComponentProps<typeof UserDialog>["onCreate"];
  onUserUpdate: React.ComponentProps<typeof UserDialog>["onUpdate"];
  itemDialogModel: React.ComponentProps<typeof ItemDialog>["dialogModel"];
  onItemDialogOpenChange: React.ComponentProps<typeof ItemDialog>["onOpenChange"];
  onItemDialogSave: (payload: ItemDialogCommitPayload) => boolean;
  materialDialogModel: React.ComponentProps<typeof MaterialDialog>["dialogModel"];
  onMaterialDialogOpenChange: React.ComponentProps<typeof MaterialDialog>["onOpenChange"];
  onMaterialDialogSave: React.ComponentProps<typeof MaterialDialog>["onSave"];
  recipeDialogOpen: boolean;
  onRecipeDialogOpenChange: (open: boolean) => void;
  activeRecipeItemName: string | null;
  activeRecipeItemUnit: string | null;
  recipeDraft: RecipeLine[];
  onRecipeDraftChange: React.Dispatch<React.SetStateAction<RecipeLine[]>>;
  materialOptions: SearchableOption[];
  materialMap: Map<string, Material>;
  materialsMaster: Material[];
  canEdit: boolean;
  modalWideClassName: string;
  modalBodyClassName: string;
  onRecipeSave: () => void;
  constraintsDialogOpen: boolean;
  onConstraintsDialogOpenChange: (open: boolean) => void;
  onConstraintsSave: () => void | Promise<void>;
  constraintsDialogModel: ConditionsDialogModel;
  constraintsDialogActions: ConditionsDialogActions;
  blockDetailDialogModel: BlockDetailDialogModel;
  blockDetailDialogActions: BlockDetailDialogActions;
  onPlanOpenChange: (open: boolean) => void;
  onPlanSave: () => void;
};

export function ManufacturingPlanDialogs({
  userDialogModel,
  onUserDialogOpenChange,
  onUserCreate,
  onUserUpdate,
  itemDialogModel,
  onItemDialogOpenChange,
  onItemDialogSave,
  materialDialogModel,
  onMaterialDialogOpenChange,
  onMaterialDialogSave,
  recipeDialogOpen,
  onRecipeDialogOpenChange,
  activeRecipeItemName,
  activeRecipeItemUnit,
  recipeDraft,
  onRecipeDraftChange,
  materialOptions,
  materialMap,
  materialsMaster,
  canEdit,
  modalWideClassName,
  modalBodyClassName,
  onRecipeSave,
  constraintsDialogOpen,
  onConstraintsDialogOpenChange,
  onConstraintsSave,
  constraintsDialogModel,
  constraintsDialogActions,
  blockDetailDialogModel,
  blockDetailDialogActions,
  onPlanOpenChange,
  onPlanSave,
}: ManufacturingPlanDialogsProps): JSX.Element {
  return (
    <>
      <UserDialog
        dialogModel={userDialogModel}
        onOpenChange={onUserDialogOpenChange}
        onCreate={onUserCreate}
        onUpdate={onUserUpdate}
      />

      <ItemDialog dialogModel={itemDialogModel} onOpenChange={onItemDialogOpenChange} onSave={onItemDialogSave} />

      <MaterialDialog
        dialogModel={materialDialogModel}
        onOpenChange={onMaterialDialogOpenChange}
        onSave={onMaterialDialogSave}
      />

      <Dialog open={recipeDialogOpen} onOpenChange={onRecipeDialogOpenChange}>
        <DialogContent className={modalWideClassName}>
          <DialogHeader>
            <DialogTitle>レシピ設定{activeRecipeItemName ? `：${activeRecipeItemName}` : ""}</DialogTitle>
          </DialogHeader>

          <div className={modalBodyClassName}>
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-muted-foreground">
                係数は「製品1{activeRecipeItemUnit ?? ""}あたりの原料量」です。
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
                            onRecipeDraftChange((prev) =>
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
                          onChange={(event) => {
                            const v = event.target.value;
                            onRecipeDraftChange((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, perUnit: safeNumber(v) } : x))
                            );
                          }}
                        />
                      </div>
                      <div className="col-span-2">
                        <Select
                          value={r.unit}
                          onValueChange={(value) => {
                            const unit = asRecipeUnit(value);
                            onRecipeDraftChange((prev) => prev.map((x, i) => (i === idx ? { ...x, unit } : x)));
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
                        <Button variant="outline" onClick={() => onRecipeDraftChange((prev) => prev.filter((_, i) => i !== idx))}>
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
                        onRecipeDraftChange((prev) => [
                          ...prev,
                          {
                            materialId: fallbackMaterial?.id ?? "",
                            perUnit: 0,
                            unit: fallbackMaterial?.unit ?? DEFAULT_MATERIAL_UNIT,
                          },
                        ]);
                      }}
                      disabled={!canEdit}
                    >
                      追加
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onRecipeDialogOpenChange(false)}>
              キャンセル
            </Button>
            <Button onClick={onRecipeSave} disabled={!canEdit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConditionsDialog
        open={constraintsDialogOpen}
        onOpenChange={onConstraintsDialogOpenChange}
        onSave={() => void onConstraintsSave()}
        dialogModel={constraintsDialogModel}
        dialogActions={constraintsDialogActions}
        modalBodyClassName={modalBodyClassName}
        modalWideClassName={modalWideClassName}
      />

      <BlockDetailDialog
        dialogModel={blockDetailDialogModel}
        dialogActions={blockDetailDialogActions}
        onOpenChange={onPlanOpenChange}
        onSave={onPlanSave}
      />
    </>
  );
}
