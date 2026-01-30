import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AuthUser } from "@/types/planning";

type ViewKey = "schedule" | "inventory" | "master" | "import" | "manual";

type ManufacturingPlanLayoutProps = {
  navOpen: boolean;
  setNavOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeView: ViewKey;
  setActiveView: React.Dispatch<React.SetStateAction<ViewKey>>;
  viewLabel: string;
  authUser: AuthUser;
  authRoleLabel: string;
  canEdit: boolean;
  onLogout: () => void;
  onSelectMasterHome?: () => void;
  children: React.ReactNode;
};

export function ManufacturingPlanLayout({
  navOpen,
  setNavOpen,
  activeView,
  setActiveView,
  viewLabel,
  authUser,
  authRoleLabel,
  canEdit,
  onLogout,
  onSelectMasterHome,
  children,
}: ManufacturingPlanLayoutProps): JSX.Element {
  const handleSelectView = (view: ViewKey) => {
    setActiveView(view);
    setNavOpen(false);
  };

  const handleSelectMasterHome = () => {
    if (onSelectMasterHome) {
      onSelectMasterHome();
    } else {
      setActiveView("master");
    }
    setNavOpen(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div
        className={`fixed inset-0 z-[70] bg-black/30 transition ${
          navOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setNavOpen(false)}
      />
      <aside
        className={`fixed left-0 top-0 z-[80] h-full w-64 border-r bg-background shadow-sm transition-transform ${
          navOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="flex items-center justify-between">
            <div className="text-lg font-semibold">メニュー</div>
            <button type="button" className="rounded-md border px-2 py-1 text-sm" onClick={() => setNavOpen(false)}>
              閉じる
            </button>
          </div>
          <nav className="space-y-1">
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "schedule" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => handleSelectView("schedule")}
            >
              スケジュール
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "inventory" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => handleSelectView("inventory")}
            >
              在庫データ
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "import" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => handleSelectView("import")}
            >
              Excel取り込み
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "master" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={handleSelectMasterHome}
            >
              マスタ管理
            </button>
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                activeView === "manual" ? "bg-muted font-semibold" : "hover:bg-muted/50"
              }`}
              onClick={() => handleSelectView("manual")}
            >
              マニュアル
            </button>
          </nav>
        </div>
      </aside>

      <div className="min-h-screen">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
          <button
            type="button"
            className="rounded-md border p-2 hover:bg-muted"
            onClick={() => setNavOpen((prev) => !prev)}
            aria-label="メニューを開く"
          >
            <span className="block h-0.5 w-5 bg-foreground" />
            <span className="mt-1 block h-0.5 w-5 bg-foreground" />
            <span className="mt-1 block h-0.5 w-5 bg-foreground" />
          </button>
          <div>
            <div className="text-sm text-muted-foreground">画面</div>
            <div className="text-base font-semibold">{viewLabel}</div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="text-sm text-foreground">{authUser.name}</span>
            <span>({authRoleLabel})</span>
            {!canEdit ? <Badge variant="outline">閲覧専用</Badge> : null}
            <Button variant="outline" size="sm" onClick={onLogout}>
              ログアウト
            </Button>
          </div>
        </header>

        <main className="p-4">{children}</main>
      </div>
    </div>
  );
}
