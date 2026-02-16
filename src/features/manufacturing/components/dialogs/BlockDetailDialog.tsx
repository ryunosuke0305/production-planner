import type { Dispatch, SetStateAction } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { Textarea } from "@/components/ui/textarea";
import { toMD } from "@/lib/datetime";
import { durationLabel } from "@/lib/format";
import { slotLabelFromCalendar } from "@/lib/slots";
import type { Block, CalendarDay, Density, Item, RecipeUnit } from "@/types/planning";

export type BlockDetailDialogOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
};

export type BlockDetailDialogMaterial = {
  materialId: string;
  materialName: string;
  qty: number;
  unit: RecipeUnit;
};

export type BlockDetailDialogModel = {
  open: boolean;
  modalBodyClassName: string;
  planDensity: Density;
  planCalendarDays: CalendarDay[];
  planHoursByDay: Array<Array<number | null>>;
  planSlotCount: number;
  activeBlock: Block | null;
  activeItem: Item | null;
  items: Item[];
  itemOptions: BlockDetailDialogOption[];
  materials: BlockDetailDialogMaterial[];
  formItemId: string;
  formAmount: string;
  formMemo: string;
  formApproved: boolean;
  activeManufactureDate: string | null;
  activeExpirationDate: string | null;
  canEdit: boolean;
  canApprove: boolean;
};

export type BlockDetailDialogActions = {
  onChangeItemId: (value: string) => void;
  onChangeAmount: (value: string) => void;
  onChangeMemo: (value: string) => void;
  setFormApproved: Dispatch<SetStateAction<boolean>>;
  setBlocks: Dispatch<SetStateAction<Block[]>>;
  setActiveBlockId: Dispatch<SetStateAction<string | null>>;
  setPendingBlockId: Dispatch<SetStateAction<string | null>>;
};

type BlockDetailDialogProps = {
  dialogModel: BlockDetailDialogModel;
  dialogActions: BlockDetailDialogActions;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
};

const formatOperatorName = (value?: string) => (value && value.trim() ? value : "未設定");

export function BlockDetailDialog({
  dialogModel,
  dialogActions,
  onOpenChange,
  onSave,
}: BlockDetailDialogProps): JSX.Element {
  const {
    open,
    modalBodyClassName,
    planDensity,
    planCalendarDays,
    planHoursByDay,
    planSlotCount,
    activeBlock,
    activeItem,
    items,
    itemOptions,
    materials,
    formItemId,
    formAmount,
    formMemo,
    formApproved,
    activeManufactureDate,
    activeExpirationDate,
    canEdit,
    canApprove,
  } = dialogModel;

  const toggleBlockApproval = () => {
    if (!canApprove) return;
    if (!activeBlock) return;
    dialogActions.setFormApproved((prev) => !prev);
  };

  const onPlanDelete = () => {
    if (!canEdit) return;
    if (!activeBlock) return;
    const targetItem = items.find((item) => item.id === activeBlock.itemId);
    const targetName = targetItem?.name ?? "ブロック";
    const confirmed = window.confirm(`${targetName} のブロックを削除しますか？`);
    if (!confirmed) return;
    dialogActions.setBlocks((prev) => prev.filter((b) => b.id !== activeBlock.id));
    dialogActions.setPendingBlockId(null);
    dialogActions.setActiveBlockId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-w-xl max-h-[90vh] flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {activeItem ? activeItem.name : ""}
            {activeBlock ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {slotLabelFromCalendar({
                  density: planDensity,
                  calendarDays: planCalendarDays,
                  hoursByDay: planHoursByDay,
                  slotIndex: activeBlock.start,
                })}
                {activeBlock.len ? `（${durationLabel(activeBlock.len, planDensity)}）` : ""}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className={`flex-1 overflow-y-auto ${modalBodyClassName}`}>
          <div className="space-y-5">
            <div className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-50 p-3">
              <div className="col-span-4 text-sm text-muted-foreground">品目</div>
              <div className="col-span-8">
                <SearchableCombobox
                  value={formItemId}
                  options={itemOptions}
                  onChange={(value) => dialogActions.onChangeItemId(value)}
                  placeholder="品目を検索"
                  emptyLabel={items.length ? "該当する品目がありません" : "品目が未登録です"}
                  disabled={!items.length || !canEdit}
                />
              </div>
            </div>
            <div className="grid grid-cols-12 items-center gap-2 rounded-lg bg-slate-50 p-3">
              <div className="col-span-4 text-sm text-muted-foreground">生産数量</div>
              <div className="col-span-6">
                <Input
                  inputMode="decimal"
                  value={formAmount}
                  onChange={(e) => dialogActions.onChangeAmount(e.target.value)}
                  placeholder="0"
                  disabled={!canEdit}
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
                onChange={(e) => dialogActions.onChangeMemo(e.target.value)}
                placeholder="段取り・注意点・引当メモなど"
                disabled={!canEdit}
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
                      <Button variant="outline" size="sm" onClick={toggleBlockApproval} disabled={!canApprove}>
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
                        hoursByDay: planHoursByDay,
                        slotIndex: activeBlock.start,
                      })}
                      <span className="mx-1 text-muted-foreground">→</span>
                      {slotLabelFromCalendar({
                        density: planDensity,
                        calendarDays: planCalendarDays,
                        hoursByDay: planHoursByDay,
                        slotIndex: Math.min(planSlotCount - 1, activeBlock.start + activeBlock.len - 1),
                      })}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-12 gap-2 text-xs">
                    <div className="col-span-4 text-muted-foreground">登録者</div>
                    <div className="col-span-8 font-medium">{formatOperatorName(activeBlock.createdBy)}</div>
                    <div className="col-span-4 text-muted-foreground">更新者</div>
                    <div className="col-span-8 font-medium">{formatOperatorName(activeBlock.updatedBy)}</div>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 z-10 shrink-0 gap-2 bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={onPlanDelete} disabled={!canEdit}>
            削除
          </Button>
          <Button onClick={onSave} disabled={!canEdit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
