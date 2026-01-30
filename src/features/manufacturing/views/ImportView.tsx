import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InfoTooltip } from "@/features/manufacturing/components/InfoTooltip";
import { formatUpdatedAt } from "@/lib/format";
import type { DailyStockEntry, ImportHeaderOverrides, Item, Material } from "@/types/planning";

type ImportViewProps = {
  exportDailyStockCsv: () => void;
  dailyStocks: DailyStockEntry[];
  dailyStockUpdatedAt: string | null;
  dailyStockInputKey: number;
  canEdit: boolean;
  setDailyStockImportFile: (file: File | null) => void;
  setDailyStockImportNote: (note: string | null) => void;
  setDailyStockImportError: (error: string | null) => void;
  dailyStockImportFile: File | null;
  handleDailyStockImportClick: () => void | Promise<void>;
  saveImportHeaderOverrides: () => void | Promise<void>;
  importHeaderSaveBusy: boolean;
  dailyStockHeaderOverrides: ImportHeaderOverrides["dailyStock"];
  setDailyStockHeaderOverrides: React.Dispatch<React.SetStateAction<ImportHeaderOverrides["dailyStock"]>>;
  importHeaderSaveNote: string | null;
  importHeaderSaveError: string | null;
  dailyStockImportNote: string | null;
  dailyStockImportError: string | null;
  exportItemMasterCsv: () => void;
  items: Item[];
  itemMasterInputKey: number;
  setItemMasterImportFile: (file: File | null) => void;
  setItemMasterImportNote: (note: string | null) => void;
  setItemMasterImportError: (error: string | null) => void;
  itemMasterImportFile: File | null;
  handleItemMasterImportClick: () => void | Promise<void>;
  itemMasterImportNote: string | null;
  itemMasterImportError: string | null;
  exportMaterialMasterCsv: () => void;
  materialsMaster: Material[];
  materialMasterInputKey: number;
  setMaterialMasterImportFile: (file: File | null) => void;
  setMaterialMasterImportNote: (note: string | null) => void;
  setMaterialMasterImportError: (error: string | null) => void;
  materialMasterImportFile: File | null;
  handleMaterialMasterImportClick: () => void | Promise<void>;
  materialMasterImportNote: string | null;
  materialMasterImportError: string | null;
};

const importHeaderTooltips = {
  dailyStock: {
    date: "在庫を計上する対象日。\n形式: yyyyMMdd または yyyy-MM-dd",
    itemCode: "在庫を紐づける品目コード。\n形式: 品目マスタの品目コードと一致する文字列",
    stock: "対象日の在庫数量。\n形式: 数値（小数可）",
    shipped: "対象日の出荷数量。\n形式: 数値（小数可）",
  },
};

export function ImportView({
  exportDailyStockCsv,
  dailyStocks,
  dailyStockUpdatedAt,
  dailyStockInputKey,
  canEdit,
  setDailyStockImportFile,
  setDailyStockImportNote,
  setDailyStockImportError,
  dailyStockImportFile,
  handleDailyStockImportClick,
  saveImportHeaderOverrides,
  importHeaderSaveBusy,
  dailyStockHeaderOverrides,
  setDailyStockHeaderOverrides,
  importHeaderSaveNote,
  importHeaderSaveError,
  dailyStockImportNote,
  dailyStockImportError,
  exportItemMasterCsv,
  items,
  itemMasterInputKey,
  setItemMasterImportFile,
  setItemMasterImportNote,
  setItemMasterImportError,
  itemMasterImportFile,
  handleItemMasterImportClick,
  itemMasterImportNote,
  itemMasterImportError,
  exportMaterialMasterCsv,
  materialsMaster,
  materialMasterInputKey,
  setMaterialMasterImportFile,
  setMaterialMasterImportNote,
  setMaterialMasterImportError,
  materialMasterImportFile,
  handleMaterialMasterImportClick,
  materialMasterImportNote,
  materialMasterImportError,
}: ImportViewProps): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">Excel取り込み</div>
        <div className="text-sm text-muted-foreground">日別在庫・各マスタをExcelから取り込みます。</div>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-medium">日別在庫（yyyyMMdd / 品目コード / 在庫数 / 出荷数）</CardTitle>
            <Button variant="outline" size="sm" onClick={exportDailyStockCsv} disabled={!dailyStocks.length}>
              CSVエクスポート
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">最終更新: {formatUpdatedAt(dailyStockUpdatedAt)}</div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <Input
            key={`daily-stock-${dailyStockInputKey}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!canEdit}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setDailyStockImportFile(file);
              setDailyStockImportNote(null);
              setDailyStockImportError(null);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>{dailyStockImportFile ? `選択中: ${dailyStockImportFile.name}` : "ファイル未選択"}</div>
            <Button size="sm" onClick={() => void handleDailyStockImportClick()} disabled={!dailyStockImportFile || !canEdit}>
              取り込み
            </Button>
          </div>
          <div className="rounded-lg border bg-muted/10 p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="font-semibold text-slate-700">ヘッダー指定（任意）</div>
                <div className="text-muted-foreground">
                  カンマ区切りで列名候補を追加できます。入力した候補を優先的に検索します。
                </div>
              </div>
              <Button size="sm" onClick={() => void saveImportHeaderOverrides()} disabled={importHeaderSaveBusy || !canEdit}>
                設定を保存
              </Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  日付
                  <InfoTooltip text={importHeaderTooltips.dailyStock.date} />
                </div>
                <Input
                  value={dailyStockHeaderOverrides.date}
                  placeholder="例: 取込日, 入荷日"
                  onChange={(event) =>
                    setDailyStockHeaderOverrides((prev) => ({
                      ...prev,
                      date: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  品目コード
                  <InfoTooltip text={importHeaderTooltips.dailyStock.itemCode} />
                </div>
                <Input
                  value={dailyStockHeaderOverrides.itemCode}
                  placeholder="例: 商品コード, SKU"
                  onChange={(event) =>
                    setDailyStockHeaderOverrides((prev) => ({
                      ...prev,
                      itemCode: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  在庫数
                  <InfoTooltip text={importHeaderTooltips.dailyStock.stock} />
                </div>
                <Input
                  value={dailyStockHeaderOverrides.stock}
                  placeholder="例: 在庫数量, 残数"
                  onChange={(event) =>
                    setDailyStockHeaderOverrides((prev) => ({
                      ...prev,
                      stock: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
                  出荷数
                  <InfoTooltip text={importHeaderTooltips.dailyStock.shipped} />
                </div>
                <Input
                  value={dailyStockHeaderOverrides.shipped}
                  placeholder="例: 出荷数量, 出庫数"
                  onChange={(event) =>
                    setDailyStockHeaderOverrides((prev) => ({
                      ...prev,
                      shipped: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            {importHeaderSaveNote ? (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
                {importHeaderSaveNote}
              </div>
            ) : null}
            {importHeaderSaveError ? (
              <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {importHeaderSaveError}
              </div>
            ) : null}
          </div>
          {dailyStockImportNote ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              {dailyStockImportNote}
            </div>
          ) : null}
          {dailyStockImportError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {dailyStockImportError}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-medium">品目マスタ</CardTitle>
            <Button variant="outline" size="sm" onClick={exportItemMasterCsv} disabled={!items.length}>
              CSVエクスポート
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="text-xs text-muted-foreground">
            必須列: 品目コード / 品目名。任意列: 単位 / 計画方針 / 安全在庫 / 安全在庫自動計算 / 安全在庫参照日数 /
            安全在庫係数 / 賞味期限日数 / 製造効率 / 包装効率 / 備考
          </div>
          <div className="text-xs text-muted-foreground">品目コードをキーに上書き・追加します。</div>
          <Input
            key={`item-master-${itemMasterInputKey}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!canEdit}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setItemMasterImportFile(file);
              setItemMasterImportNote(null);
              setItemMasterImportError(null);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>{itemMasterImportFile ? `選択中: ${itemMasterImportFile.name}` : "ファイル未選択"}</div>
            <Button size="sm" onClick={() => void handleItemMasterImportClick()} disabled={!itemMasterImportFile || !canEdit}>
              取り込み
            </Button>
          </div>
          {itemMasterImportNote ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              {itemMasterImportNote}
            </div>
          ) : null}
          {itemMasterImportError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {itemMasterImportError}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base font-medium">原料マスタ</CardTitle>
            <Button variant="outline" size="sm" onClick={exportMaterialMasterCsv} disabled={!materialsMaster.length}>
              CSVエクスポート
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="text-xs text-muted-foreground">必須列: 原料コード / 原料名。任意列: 単位</div>
          <div className="text-xs text-muted-foreground">原料コードをキーに上書き・追加します。</div>
          <Input
            key={`material-master-${materialMasterInputKey}`}
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={!canEdit}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              setMaterialMasterImportFile(file);
              setMaterialMasterImportNote(null);
              setMaterialMasterImportError(null);
            }}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <div>{materialMasterImportFile ? `選択中: ${materialMasterImportFile.name}` : "ファイル未選択"}</div>
            <Button
              size="sm"
              onClick={() => void handleMaterialMasterImportClick()}
              disabled={!materialMasterImportFile || !canEdit}
            >
              取り込み
            </Button>
          </div>
          {materialMasterImportNote ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700">
              {materialMasterImportNote}
            </div>
          ) : null}
          {materialMasterImportError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {materialMasterImportError}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
