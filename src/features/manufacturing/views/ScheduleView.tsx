import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMessage } from "@/types/planning";

type ScheduleViewProps = {
  scheduleHeader: React.ReactNode;
  scheduleCard: React.ReactNode;
  chatMessages: ChatMessage[];
  chatBusy: boolean;
  chatError: string | null;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSendChatMessage: () => void | Promise<void>;
  onOpenConstraints: () => void;
  canEdit: boolean;
  chatScrollRef: React.RefObject<HTMLDivElement>;
};

export function ScheduleView({
  scheduleHeader,
  scheduleCard,
  chatMessages,
  chatBusy,
  chatError,
  chatInput,
  onChatInputChange,
  onSendChatMessage,
  onOpenConstraints,
  canEdit,
  chatScrollRef,
}: ScheduleViewProps): JSX.Element {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr] lg:items-start lg:gap-4">
      <div className="min-w-0 lg:col-start-1 lg:row-start-1">{scheduleHeader}</div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-2">{scheduleCard}</div>

      <div className="w-full shrink-0 lg:col-start-2 lg:row-start-2">
        <Card className="flex flex-col rounded-2xl shadow-sm lg:h-[calc(100vh-12rem)]">
          <CardHeader className="flex min-h-[56px] items-center pb-2">
            <div className="flex w-full items-center justify-between gap-2">
              <CardTitle className="text-base font-medium">Gemini チャット</CardTitle>
              <Button variant="outline" size="sm" onClick={onOpenConstraints} disabled={!canEdit}>
                条件設定
              </Button>
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            {chatError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                {chatError}
              </div>
            ) : null}
            <div ref={chatScrollRef} className="flex-1 space-y-2 overflow-y-auto rounded-md border bg-background p-2">
              {chatMessages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={
                      "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm " +
                      (msg.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")
                    }
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatBusy ? (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">送信中...</div>
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              <Textarea
                value={chatInput}
                onChange={(event) => onChatInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void onSendChatMessage();
                  }
                }}
                placeholder="例：品目コード A を 9/12 10:00から2時間、40ケース 追加して"
                rows={3}
                disabled={!canEdit}
              />
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Ctrl+Enter / Cmd+Enter で送信</div>
                <Button onClick={() => void onSendChatMessage()} disabled={chatBusy || !canEdit}>
                  送信
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
