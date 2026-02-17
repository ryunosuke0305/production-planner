import React, { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatQuantity } from "@/lib/format";
import { slotBoundaryToDateTime, slotToDateTime } from "@/lib/slots";
import type { Block, CalendarDay, Item } from "@/types/planning";

type PlanListViewProps = {
  blocks: Block[];
  items: Item[];
  slotIndexToLabel: string[];
  calendarDays: CalendarDay[];
  rawHoursByDay: number[][];
  slotsPerDay: number;
  canEdit: boolean;
  onEdit: (block: Block) => void;
};

type WidthState = Record<ColumnKey, number>;
type ColumnKey = "action" | "item" | "amount" | "approved" | "start" | "end" | "duration" | "memo";

type PlanRow = {
  block: Block;
  itemName: string;
  itemCode: string;
  itemUnit: string;
  startLabel: string;
  endLabel: string;
  startDateTime: Date | null;
  endDateTime: Date | null;
};

const columnOrder: ColumnKey[] = ["action", "item", "amount", "approved", "start", "end", "duration", "memo"];
const defaultColumnWidths: WidthState = {
  action: 88,
  item: 280,
  amount: 120,
  approved: 110,
  start: 180,
  end: 180,
  duration: 100,
  memo: 320,
};

export function PlanListView({
  blocks,
  items,
  slotIndexToLabel,
  calendarDays,
  rawHoursByDay,
  slotsPerDay,
  canEdit,
  onEdit,
}: PlanListViewProps): JSX.Element {
  const defaultStartDateTime = useMemo(() => {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}T00:00`;
  }, []);

  const [keyword, setKeyword] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<"all" | "approved" | "unapproved">("all");
  const [startDateTimeFilter, setStartDateTimeFilter] = useState(defaultStartDateTime);
  const [endDateTimeFilter, setEndDateTimeFilter] = useState("");
  const [columnWidths, setColumnWidths] = useState<WidthState>(defaultColumnWidths);
  const resizingRef = useRef<{ key: ColumnKey; startX: number; startWidth: number } | null>(null);

  const itemMap = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const rows = useMemo<PlanRow[]>(() => {
    return blocks
      .map((block) => {
        const item = itemMap.get(block.itemId);
        const startSlot = Math.max(0, Math.trunc(block.start ?? 0));
        const blockLen = Math.max(1, Math.trunc(block.len ?? 1));
        const startLabel = slotIndexToLabel[startSlot] ?? `slot:${startSlot}`;
        const endSlot = Math.max(startSlot + blockLen - 1, startSlot);
        const endLabel = slotIndexToLabel[endSlot] ?? `slot:${endSlot}`;
        const startDateTime = slotToDateTime(startSlot, calendarDays, rawHoursByDay, slotsPerDay);
        const endDateTime = slotBoundaryToDateTime(startSlot + blockLen, calendarDays, rawHoursByDay, slotsPerDay);
        return {
          block,
          itemName: item?.name ?? "未登録品目",
          itemCode: item?.publicId ?? "未登録品目",
          itemUnit: item?.unit ?? "",
          startLabel,
          endLabel,
          startDateTime,
          endDateTime,
        };
      })
      .sort((a, b) => (a.block.start ?? 0) - (b.block.start ?? 0));
  }, [blocks, calendarDays, itemMap, rawHoursByDay, slotIndexToLabel, slotsPerDay]);

  const filteredRows = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    const startFilterDate = startDateTimeFilter ? new Date(startDateTimeFilter) : null;
    const endFilterDate = endDateTimeFilter ? new Date(endDateTimeFilter) : null;

    return rows.filter((row) => {
      if (approvalFilter === "approved" && !row.block.approved) return false;
      if (approvalFilter === "unapproved" && row.block.approved) return false;

      if (startFilterDate && !Number.isNaN(startFilterDate.getTime())) {
        const rowEnd = row.endDateTime ?? row.startDateTime;
        if (!rowEnd || rowEnd < startFilterDate) return false;
      }

      if (endFilterDate && !Number.isNaN(endFilterDate.getTime())) {
        const rowStart = row.startDateTime ?? row.endDateTime;
        if (!rowStart || rowStart > endFilterDate) return false;
      }

      if (!normalizedKeyword) return true;
      const haystack = `${row.itemName} ${row.itemCode} ${row.block.memo}`.toLowerCase();
      return haystack.includes(normalizedKeyword);
    });
  }, [approvalFilter, endDateTimeFilter, keyword, rows, startDateTimeFilter]);

  const startResize = (event: React.MouseEvent<HTMLSpanElement>, key: ColumnKey) => {
    event.preventDefault();
    const currentWidth = columnWidths[key];
    resizingRef.current = {
      key,
      startX: event.clientX,
      startWidth: currentWidth,
    };

    const onMouseMove = (moveEvent: MouseEvent) => {
      const active = resizingRef.current;
      if (!active) return;
      const nextWidth = Math.max(80, Math.round(active.startWidth + (moveEvent.clientX - active.startX)));
      setColumnWidths((prev) => ({ ...prev, [active.key]: nextWidth }));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      resizingRef.current = null;
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const resetColumnWidth = (key: ColumnKey) => {
    setColumnWidths((prev) => ({
      ...prev,
      [key]: defaultColumnWidths[key],
    }));
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">計画一覧</div>
        <div className="text-sm text-muted-foreground">登録済みの計画情報を検索し、テーブル形式で確認・編集できます。</div>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-base font-medium">検索条件</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">キーワード（品目名 / 品目コード / メモ）</div>
              <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="例: 乳飲料 / ITM-001" />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">承認状態</div>
              <Select value={approvalFilter} onValueChange={(value) => setApprovalFilter(value as "all" | "approved" | "unapproved")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">すべて</SelectItem>
                  <SelectItem value="approved">承認済み</SelectItem>
                  <SelectItem value="unapproved">未承認</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">開始日時（この日時以降）</div>
              <Input type="datetime-local" value={startDateTimeFilter} onChange={(event) => setStartDateTimeFilter(event.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">終了日時（この日時以前）</div>
              <Input type="datetime-local" value={endDateTimeFilter} onChange={(event) => setEndDateTimeFilter(event.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-base font-medium">計画情報テーブル</CardTitle>
          <div className="text-xs text-muted-foreground">{filteredRows.length}件 / 全{rows.length}件（列の境界線ドラッグで横幅を調整、ダブルクリックで自動幅に戻せます）</div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[68vh] overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-[1100px] w-max border-separate border-spacing-0 text-sm" style={{ tableLayout: "fixed" }}>
              <colgroup>
                {columnOrder.map((key) => (
                  <col key={key} style={{ width: `${columnWidths[key]}px` }} />
                ))}
              </colgroup>
              <thead className="sticky top-0 z-30 bg-white">
                <tr>
                  {[
                    { key: "action", label: "編集" },
                    { key: "item", label: "品目" },
                    { key: "amount", label: "数量" },
                    { key: "approved", label: "承認" },
                    { key: "start", label: "開始" },
                    { key: "end", label: "終了" },
                    { key: "duration", label: "長さ" },
                    { key: "memo", label: "メモ" },
                  ].map((column, index) => {
                    const key = column.key as ColumnKey;
                    const stickyClass = index === 0 ? "sticky left-0 z-40 border-r bg-white" : "";
                    return (
                      <th key={key} className={`relative border-b border-r px-3 py-2 text-left font-medium ${stickyClass}`}>
                        <div className="pr-2">{column.label}</div>
                        <span
                          role="separator"
                          className="absolute right-0 top-0 h-full w-2 cursor-col-resize"
                          onMouseDown={(event) => startResize(event, key)}
                          onDoubleClick={() => resetColumnWidth(key)}
                          aria-label={`${column.label}列の幅を調整`}
                          title="ドラッグで幅調整 / ダブルクリックで自動幅"
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                      条件に一致する計画情報がありません。
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr key={row.block.id} className="even:bg-muted/20">
                      <td className="sticky left-0 z-20 border-b border-r bg-white px-3 py-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => onEdit(row.block)} disabled={!canEdit}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true"><path d="M12 20h9" /><path d="m16.5 3.5 4 4L7 21l-4 1 1-4z" /></svg>
                          <span className="sr-only">編集</span>
                        </Button>
                      </td>
                      <td className="border-b border-r px-3 py-2">
                        <div className="font-medium">{row.itemName}</div>
                        <div className="text-xs text-muted-foreground">{row.itemCode}{row.itemUnit ? ` / ${row.itemUnit}` : ""}</div>
                      </td>
                      <td className="border-b border-r px-3 py-2 text-right">{formatQuantity(row.block.amount)}</td>
                      <td className="border-b border-r px-3 py-2">{row.block.approved ? "承認済み" : "未承認"}</td>
                      <td className="border-b border-r px-3 py-2 whitespace-nowrap">{row.startLabel}</td>
                      <td className="border-b border-r px-3 py-2 whitespace-nowrap">{row.endLabel}</td>
                      <td className="border-b border-r px-3 py-2">{Math.max(1, row.block.len ?? 1)} slot</td>
                      <td className="border-b border-r px-3 py-2">{row.block.memo || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
