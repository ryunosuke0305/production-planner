import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANNING_POLICY_LABELS } from "@/constants/planning";
import type { AuthRole, Item, ManagedUser, Material } from "@/types/planning";

type MasterViewProps = {
  masterSection: "home" | "items" | "materials" | "users";
  onMasterSectionChange: (section: "home" | "items" | "materials" | "users") => void;
  items: Item[];
  materialsMaster: Material[];
  managedUsers: ManagedUser[];
  managedUsersNote: string | null;
  managedUsersLoading: boolean;
  managedUsersError: string | null;
  canEdit: boolean;
  applySafetyStockForTargets: () => void;
  openCreateItemModal: () => void;
  applySafetyStockForItem: (itemId: string) => void;
  openRecipeEdit: (itemId: string) => void;
  openEditItemModal: (item: Item) => void;
  openCreateMaterialModal: () => void;
  openEditMaterialModal: (materialId: string) => void;
  openCreateManagedUserModal: () => void;
  openEditManagedUserModal: (user: ManagedUser) => void;
  onDeleteManagedUser: (user: ManagedUser) => void | Promise<void>;
};

const masterSectionLabelMap: Record<MasterViewProps["masterSection"], string> = {
  home: "マスタ管理",
  items: "品目一覧",
  materials: "原料一覧",
  users: "ユーザー管理",
};

const masterSectionDescriptionMap: Record<MasterViewProps["masterSection"], string> = {
  home: "品目・原料マスタの登録・編集・削除を行います。",
  items: "品目の計画方針・安全在庫（自動計算設定）・賞味期限・製造効率・包装効率などを管理します。",
  materials: "原料の単位と名称を管理します。",
  users: "ユーザーID・表示名・権限・パスワードを管理します。",
};

const userRoleLabelMap: Record<AuthRole, string> = {
  admin: "管理者",
  requester: "依頼者",
  viewer: "閲覧者",
};

export function MasterView({
  masterSection,
  onMasterSectionChange,
  items,
  materialsMaster,
  managedUsers,
  managedUsersNote,
  managedUsersLoading,
  managedUsersError,
  canEdit,
  applySafetyStockForTargets,
  openCreateItemModal,
  applySafetyStockForItem,
  openRecipeEdit,
  openEditItemModal,
  openCreateMaterialModal,
  openEditMaterialModal,
  openCreateManagedUserModal,
  openEditManagedUserModal,
  onDeleteManagedUser,
}: MasterViewProps): JSX.Element {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-tight">{masterSectionLabelMap[masterSection]}</div>
          <div className="text-sm text-muted-foreground">{masterSectionDescriptionMap[masterSection]}</div>
        </div>
        {masterSection !== "home" ? (
          <Button variant="outline" size="sm" onClick={() => onMasterSectionChange("home")}>
            マスタ管理へ戻る
          </Button>
        ) : null}
      </div>

      {masterSection === "home" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="rounded-2xl">
            <CardHeader className="space-y-2 pb-2">
              <CardTitle className="text-base font-medium">品目一覧</CardTitle>
              <div className="text-sm text-muted-foreground">
                品目マスタの確認・編集やレシピ登録を行います。
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="text-muted-foreground">登録件数: {items.length}件</div>
              <Button onClick={() => onMasterSectionChange("items")}>品目一覧を開く</Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="space-y-2 pb-2">
              <CardTitle className="text-base font-medium">原料一覧</CardTitle>
              <div className="text-sm text-muted-foreground">原料マスタの確認・編集を行います。</div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="text-muted-foreground">登録件数: {materialsMaster.length}件</div>
              <Button onClick={() => onMasterSectionChange("materials")}>原料一覧を開く</Button>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader className="space-y-2 pb-2">
              <CardTitle className="flex items-center gap-2 text-base font-medium">
                ユーザー管理
                {!canEdit ? <Badge variant="outline">管理者専用</Badge> : null}
              </CardTitle>
              <div className="text-sm text-muted-foreground">
                ユーザーID・表示名・権限・パスワードを管理します。
              </div>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <div className="text-muted-foreground">登録件数: {managedUsers.length}件</div>
              <Button onClick={() => onMasterSectionChange("users")} disabled={!canEdit}>
                ユーザー管理を開く
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : masterSection === "items" ? (
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-medium">品目一覧</CardTitle>
            <Button onClick={openCreateItemModal} disabled={!canEdit}>
              品目を追加
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/10 px-3 py-2 text-xs">
              <div className="space-y-1">
                <div className="font-semibold text-slate-700">安全在庫 自動計算</div>
                <div className="text-muted-foreground">
                  出荷数の直近N日分 × 係数で安全在庫を算出します。対象は「自動計算」が「対象」の品目のみです。
                </div>
              </div>
              <Button size="sm" onClick={applySafetyStockForTargets} disabled={!canEdit}>
                対象を一括計算
              </Button>
            </div>
            {items.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">品目名</th>
                      <th className="px-3 py-2 text-left font-medium">品目コード</th>
                      <th className="px-3 py-2 text-center font-medium">単位</th>
                      <th className="px-3 py-2 text-left font-medium">計画方針</th>
                      <th className="px-3 py-2 text-center font-medium">自動計算</th>
                      <th className="px-3 py-2 text-right font-medium">参照日数</th>
                      <th className="px-3 py-2 text-right font-medium">係数</th>
                      <th className="px-3 py-2 text-right font-medium">安全在庫</th>
                      <th className="px-3 py-2 text-right font-medium">賞味期限(日)</th>
                      <th className="px-3 py-2 text-right font-medium">製造効率</th>
                      <th className="px-3 py-2 text-right font-medium">包装効率</th>
                      <th className="px-3 py-2 text-left font-medium">備考</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {items.map((item) => (
                      <tr key={item.id} className="align-middle">
                        <td className="px-3 py-2">
                          <div className="font-medium">{item.name}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{item.publicId || "未設定"}</td>
                        <td className="px-3 py-2 text-center text-muted-foreground">{item.unit}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {PLANNING_POLICY_LABELS[item.planningPolicy] ?? item.planningPolicy}
                        </td>
                        <td className="px-3 py-2 text-center text-muted-foreground">
                          {item.safetyStockAutoEnabled ? "対象" : "対象外"}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {item.safetyStockLookbackDays}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          {item.safetyStockCoefficient}
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{item.safetyStock}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{item.shelfLifeDays}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          <span>{item.productionEfficiency}</span>
                          <span className="ml-1 text-xs text-slate-500">{item.unit}/人時</span>
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          <span>{item.packagingEfficiency}</span>
                          <span className="ml-1 text-xs text-slate-500">{item.unit}/人時</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          <div className="max-w-[200px] truncate">{item.notes || "-"}</div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => openRecipeEdit(item.id)} disabled={!canEdit}>
                              レシピ {item.recipe.length}件
                            </Button>
                            <Button variant="outline" onClick={() => applySafetyStockForItem(item.id)} disabled={!canEdit}>
                              安全在庫計算
                            </Button>
                            <Button variant="outline" onClick={() => openEditItemModal(item)} disabled={!canEdit}>
                              編集
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                品目マスタが未登録です。右上の「品目を追加」ボタンから追加してください。
              </div>
            )}
          </CardContent>
        </Card>
      ) : masterSection === "materials" ? (
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-medium">原料一覧</CardTitle>
            <Button onClick={openCreateMaterialModal} disabled={!canEdit}>
              原料を追加
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {materialsMaster.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">原料名</th>
                      <th className="px-3 py-2 text-left font-medium">単位</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {materialsMaster.map((material) => (
                      <tr key={material.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium">{material.name}</div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{material.unit}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => openEditMaterialModal(material.id)} disabled={!canEdit}>
                              編集
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                原料マスタが未登録です。右上の「原料を追加」ボタンから追加してください。
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base font-medium">ユーザー管理</CardTitle>
            <Button onClick={openCreateManagedUserModal} disabled={!canEdit}>
              ユーザーを追加
            </Button>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {managedUsersNote ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {managedUsersNote}
              </div>
            ) : null}
            {managedUsersLoading ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                読み込み中...
              </div>
            ) : managedUsersError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {managedUsersError}
              </div>
            ) : managedUsers.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">ユーザーID</th>
                      <th className="px-3 py-2 text-left font-medium">表示名</th>
                      <th className="px-3 py-2 text-left font-medium">権限</th>
                      <th className="px-3 py-2 text-right font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {managedUsers.map((user) => (
                      <tr key={user.id}>
                        <td className="px-3 py-2 font-medium">{user.id}</td>
                        <td className="px-3 py-2 text-muted-foreground">{user.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{userRoleLabelMap[user.role]}</td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => openEditManagedUserModal(user)}>
                              編集
                            </Button>
                            <Button variant="destructive" onClick={() => void onDeleteManagedUser(user)}>
                              削除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                ユーザーが登録されていません。
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
