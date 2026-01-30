import React, { useEffect, useMemo, useState } from "react";
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
import { DEFAULT_MATERIAL_UNIT, ITEM_UNITS } from "@/constants/planning";
import type { Item, Material, RecipeLine, RecipeUnit } from "@/types/planning";

export type MaterialDialogMode = "create" | "edit";

interface MaterialDialogModel {
  open: boolean;
  mode: MaterialDialogMode;
  editingMaterialId: string | null;
  materialsMaster: Material[];
  setMaterialsMaster: React.Dispatch<React.SetStateAction<Material[]>>;
  setItems: React.Dispatch<React.SetStateAction<Item[]>>;
  setRecipeDraft: React.Dispatch<React.SetStateAction<RecipeLine[]>>;
  modalWideClassName: string;
  modalBodyClassName: string;
  canEdit: boolean;
}

interface MaterialDialogProps {
  dialogModel: MaterialDialogModel;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: {
    mode: MaterialDialogMode;
    materialId?: string;
    name: string;
    unit: RecipeUnit;
  }) => boolean;
}

export function MaterialDialog({ dialogModel, onOpenChange, onSave }: MaterialDialogProps): JSX.Element {
  const [materialNameDraft, setMaterialNameDraft] = useState("");
  const [materialUnitDraft, setMaterialUnitDraft] = useState<RecipeUnit>(DEFAULT_MATERIAL_UNIT);
  const [editingMaterialName, setEditingMaterialName] = useState("");
  const [editingMaterialUnit, setEditingMaterialUnit] = useState<RecipeUnit>(DEFAULT_MATERIAL_UNIT);
  const [materialFormError, setMaterialFormError] = useState<string | null>(null);

  const editingMaterial = useMemo(
    () =>
      dialogModel.mode === "edit" && dialogModel.editingMaterialId
        ? dialogModel.materialsMaster.find((material) => material.id === dialogModel.editingMaterialId) ?? null
        : null,
    [dialogModel.editingMaterialId, dialogModel.materialsMaster, dialogModel.mode]
  );

  useEffect(() => {
    if (!dialogModel.open) return;
    if (dialogModel.mode === "create") {
      setMaterialNameDraft("");
      setMaterialUnitDraft(DEFAULT_MATERIAL_UNIT);
      setMaterialFormError(null);
      return;
    }
    if (editingMaterial) {
      setEditingMaterialName(editingMaterial.name);
      setEditingMaterialUnit(editingMaterial.unit);
      setMaterialFormError(null);
    } else {
      setEditingMaterialName("");
      setEditingMaterialUnit(DEFAULT_MATERIAL_UNIT);
      setMaterialFormError(null);
    }
  }, [dialogModel.open, dialogModel.mode, editingMaterial]);

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setMaterialFormError(null);
    }
  };

  const handleDelete = () => {
    if (!editingMaterial) return;
    const confirmed = window.confirm(`${editingMaterial.name} を削除しますか？`);
    if (!confirmed) return;
    const materialId = editingMaterial.id;
    dialogModel.setMaterialsMaster((prev) => prev.filter((material) => material.id !== materialId));
    dialogModel.setItems((prev) =>
      prev.map((item) => ({
        ...item,
        recipe: item.recipe.filter((line) => line.materialId !== materialId),
      }))
    );
    dialogModel.setRecipeDraft((prev) => prev.filter((line) => line.materialId !== materialId));
    onOpenChange(false);
  };

  const handleSave = () => {
    const isEditMode = dialogModel.mode === "edit";
    const nextName = (isEditMode ? editingMaterialName : materialNameDraft).trim();
    if (!nextName) {
      setMaterialFormError("原料名を入力してください。");
      return;
    }
    if (
      dialogModel.materialsMaster.some(
        (material) => material.name === nextName && (!isEditMode || material.id !== dialogModel.editingMaterialId)
      )
    ) {
      setMaterialFormError("同じ原料名がすでに登録されています。");
      return;
    }
    const didSave = onSave({
      mode: dialogModel.mode,
      materialId: isEditMode ? dialogModel.editingMaterialId ?? undefined : undefined,
      name: nextName,
      unit: isEditMode ? editingMaterialUnit : materialUnitDraft,
    });
    if (didSave) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={dialogModel.open} onOpenChange={handleOpenChange}>
      <DialogContent className={dialogModel.modalWideClassName}>
        <DialogHeader>
          <DialogTitle>{dialogModel.mode === "edit" ? "原料を編集" : "原料を追加"}</DialogTitle>
        </DialogHeader>

        <div className={dialogModel.modalBodyClassName}>
          <div className="rounded-xl border bg-white p-4 shadow-sm">
            <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
              <div className="text-sm font-medium text-muted-foreground">原料名</div>
              <Input
                value={dialogModel.mode === "edit" ? editingMaterialName : materialNameDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  if (dialogModel.mode === "edit") {
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
                value={dialogModel.mode === "edit" ? editingMaterialUnit : materialUnitDraft}
                onValueChange={(value) => {
                  if (dialogModel.mode === "edit") {
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
