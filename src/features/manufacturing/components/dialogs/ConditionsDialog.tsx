import React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type ConditionsDialogModel = {
  constraintsDraft: string;
  geminiHorizonDaysDraft: string;
  constraintsError: string | null;
  constraintsBusy: boolean;
  canEdit: boolean;
};

export type ConditionsDialogActions = {
  onChangeConstraintsDraft: (value: string) => void;
  onChangeGeminiHorizonDaysDraft: (value: string) => void;
};

type ConditionsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  dialogModel: ConditionsDialogModel;
  dialogActions: ConditionsDialogActions;
  modalBodyClassName: string;
  modalWideClassName: string;
};

export function ConditionsDialog({
  open,
  onOpenChange,
  onSave,
  dialogModel,
  dialogActions,
  modalBodyClassName,
  modalWideClassName,
}: ConditionsDialogProps): JSX.Element {
  const handleConstraintsDraftChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    dialogActions.onChangeConstraintsDraft(event.target.value);
  };

  const handleHorizonDaysDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    dialogActions.onChangeGeminiHorizonDaysDraft(event.target.value);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                  value={dialogModel.geminiHorizonDaysDraft}
                  onChange={handleHorizonDaysDraftChange}
                  className="w-28"
                  disabled={!dialogModel.canEdit}
                />
                <span className="text-sm text-muted-foreground">日先まで</span>
              </div>
              <div className="text-xs text-muted-foreground">
                今日を起点に、指定日数分の計画データのみをGeminiへ渡します。
              </div>
            </div>
            <Textarea
              value={dialogModel.constraintsDraft}
              onChange={handleConstraintsDraftChange}
              className="min-h-[220px]"
              placeholder="例：設備Xは午前のみ稼働、残業は不可、最小ロットは50ケース など"
              disabled={!dialogModel.canEdit}
            />
            {dialogModel.constraintsError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {dialogModel.constraintsError}
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={dialogModel.constraintsBusy}>
            キャンセル
          </Button>
          <Button onClick={onSave} disabled={dialogModel.constraintsBusy || !dialogModel.canEdit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
