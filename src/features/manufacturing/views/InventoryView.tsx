import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toMD } from "@/lib/datetime";
import { formatQuantity } from "@/lib/format";
import type { DailyStockEntry, Item } from "@/types/planning";

type InventoryViewProps = {
  inventoryItems: Item[];
  inventoryDates: string[];
  dailyStocks: DailyStockEntry[];
  dailyStockEntryMap: Map<string, Map<string, DailyStockEntry>>;
};

export function InventoryView({
  inventoryItems,
  inventoryDates,
  dailyStocks,
  dailyStockEntryMap,
}: InventoryViewProps): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">在庫データ</div>
        <div className="text-sm text-muted-foreground">
          現在取り込まれている日別在庫を、品目×日付の一覧で確認できます。
        </div>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-base font-medium">日別在庫一覧</CardTitle>
          <div className="text-xs text-muted-foreground">
            品目数: {inventoryItems.length}件 / 日付数: {inventoryDates.length}日
          </div>
        </CardHeader>
        <CardContent>
          {dailyStocks.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              在庫データが未取り込みです。Excel取り込み画面から日別在庫を登録してください。
            </div>
          ) : inventoryItems.length === 0 || inventoryDates.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              在庫データの表示対象がありません。品目コードの整合性を確認してください。
            </div>
          ) : (
            <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
              <table className="min-w-[720px] border-collapse text-sm">
                <thead className="sticky top-0 z-20 bg-white">
                  <tr>
                    <th className="sticky left-0 z-30 border-b border-r bg-white px-3 py-2 text-left font-medium">
                      品目
                    </th>
                    {inventoryDates.map((date) => (
                      <th key={date} className="border-b px-3 py-2 text-center text-xs font-medium text-muted-foreground">
                        {toMD(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {inventoryItems.map((item) => {
                    const entryMap = dailyStockEntryMap.get(item.id);
                    return (
                      <tr key={item.id} className="even:bg-muted/30">
                        <td className="sticky left-0 z-10 border-b border-r bg-white px-3 py-2 align-top">
                          <div className="font-medium text-slate-800">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.publicId ?? item.id}</div>
                        </td>
                        {inventoryDates.map((date) => {
                          const entry = entryMap?.get(date);
                          return (
                            <td key={`${item.id}-${date}`} className="border-b px-3 py-2 align-top">
                              {entry ? (
                                <div className="space-y-1 text-right">
                                  <div className="font-medium">
                                    {formatQuantity(entry.stock)}
                                    <span className="ml-1 text-xs text-muted-foreground">{item.unit}</span>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    出荷 {formatQuantity(entry.shipped)}
                                  </div>
                                </div>
                              ) : (
                                <div className="text-center text-xs text-muted-foreground">-</div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
