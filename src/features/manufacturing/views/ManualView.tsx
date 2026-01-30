import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import manualAdmin from "../../../../data/manual-admin.md?raw";
import manualUser from "../../../../data/manual-user.md?raw";

type ManualViewProps = {
  manualAudience: "user" | "admin";
  onManualAudienceChange: (audience: "user" | "admin") => void;
};

export function ManualView({ manualAudience, onManualAudienceChange }: ManualViewProps): JSX.Element {
  const manualMarkdown = manualAudience === "user" ? manualUser : manualAdmin;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">操作マニュアル</div>
        <div className="text-sm text-muted-foreground">
          目的別に必要な操作を確認できます。利用対象を切り替えて参照してください。
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant={manualAudience === "user" ? "default" : "outline"}
          size="sm"
          onClick={() => onManualAudienceChange("user")}
        >
          一般利用者向け
        </Button>
        <Button
          variant={manualAudience === "admin" ? "default" : "outline"}
          size="sm"
          onClick={() => onManualAudienceChange("admin")}
        >
          システム管理者向け
        </Button>
      </div>
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            {manualAudience === "user" ? "一般利用者向けマニュアル" : "システム管理者向けマニュアル"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h2 className="text-lg font-semibold text-slate-800">{children}</h2>,
              h2: ({ children }) => <h3 className="text-base font-semibold text-slate-800">{children}</h3>,
              h3: ({ children }) => <h4 className="text-sm font-semibold text-slate-700">{children}</h4>,
              p: ({ children }) => <p className="text-slate-700">{children}</p>,
              ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 text-slate-700">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 text-slate-700">{children}</ol>,
              li: ({ children }) => <li>{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-slate-800">{children}</strong>,
              code: ({ children }) => (
                <code className="rounded bg-muted px-1 py-0.5 text-[0.85em] text-slate-800">{children}</code>
              ),
            }}
          >
            {manualMarkdown}
          </ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
}
