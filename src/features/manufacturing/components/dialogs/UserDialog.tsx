import { useEffect, useState } from "react";
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
import type { AuthRole, ManagedUser } from "@/types/planning";

type UserDialogMode = "create" | "edit";

interface UserDialogModel {
  open: boolean;
  mode: UserDialogMode;
  editingUser: ManagedUser | null;
  modalWideClassName: string;
  modalBodyClassName: string;
}

interface UserDialogProps {
  dialogModel: UserDialogModel;
  onOpenChange: (open: boolean) => void;
  onCreate: (payload: {
    id: string;
    name: string;
    role: AuthRole;
    password: string;
  }) => Promise<{ error?: string } | undefined>;
  onUpdate: (payload: {
    id: string;
    name: string;
    role: AuthRole;
    password?: string;
  }) => Promise<{ error?: string } | undefined>;
}

export function UserDialog({ dialogModel, onOpenChange, onCreate, onUpdate }: UserDialogProps): JSX.Element {
  const [newUserId, setNewUserId] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserRole, setNewUserRole] = useState<AuthRole>("viewer");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserPasswordConfirm, setNewUserPasswordConfirm] = useState("");
  const [userCreateBusy, setUserCreateBusy] = useState(false);
  const [userCreateError, setUserCreateError] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState("");
  const [editUserRole, setEditUserRole] = useState<AuthRole>("viewer");
  const [editUserPassword, setEditUserPassword] = useState("");
  const [editUserPasswordConfirm, setEditUserPasswordConfirm] = useState("");
  const [userEditBusy, setUserEditBusy] = useState(false);
  const [userEditError, setUserEditError] = useState<string | null>(null);

  useEffect(() => {
    if (!dialogModel.open) return;
    if (dialogModel.mode === "create") {
      setNewUserId("");
      setNewUserName("");
      setNewUserRole("viewer");
      setNewUserPassword("");
      setNewUserPasswordConfirm("");
      setUserCreateError(null);
      setUserCreateBusy(false);
      return;
    }
    if (dialogModel.editingUser) {
      setEditUserName(dialogModel.editingUser.name);
      setEditUserRole(dialogModel.editingUser.role);
      setEditUserPassword("");
      setEditUserPasswordConfirm("");
      setUserEditError(null);
      setUserEditBusy(false);
    }
  }, [dialogModel.open, dialogModel.mode, dialogModel.editingUser]);

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
    if (!open) {
      setUserCreateError(null);
      setUserEditError(null);
      setUserCreateBusy(false);
      setUserEditBusy(false);
    }
  };

  const handleCreate = async () => {
    setUserCreateError(null);
    const trimmedId = newUserId.trim();
    const trimmedName = newUserName.trim();
    if (!trimmedId || !trimmedName) {
      setUserCreateError("ユーザーIDと表示名を入力してください。");
      return;
    }
    if (!newUserPassword) {
      setUserCreateError("パスワードを入力してください。");
      return;
    }
    if (newUserPassword !== newUserPasswordConfirm) {
      setUserCreateError("パスワードが一致しません。");
      return;
    }
    setUserCreateBusy(true);
    const result = await onCreate({
      id: trimmedId,
      name: trimmedName,
      role: newUserRole,
      password: newUserPassword,
    });
    if (result?.error) {
      setUserCreateError(result.error);
    } else {
      setNewUserId("");
      setNewUserName("");
      setNewUserRole("viewer");
      setNewUserPassword("");
      setNewUserPasswordConfirm("");
    }
    setUserCreateBusy(false);
  };

  const handleUpdate = async () => {
    if (!dialogModel.editingUser) return;
    setUserEditError(null);
    const trimmedName = editUserName.trim();
    if (!trimmedName) {
      setUserEditError("表示名を入力してください。");
      return;
    }
    if (editUserPassword && editUserPassword !== editUserPasswordConfirm) {
      setUserEditError("パスワードが一致しません。");
      return;
    }
    setUserEditBusy(true);
    const result = await onUpdate({
      id: dialogModel.editingUser.id,
      name: trimmedName,
      role: editUserRole,
      password: editUserPassword || undefined,
    });
    if (result?.error) {
      setUserEditError(result.error);
    }
    setUserEditBusy(false);
  };

  return (
    <Dialog open={dialogModel.open} onOpenChange={handleOpenChange}>
      <DialogContent className={dialogModel.modalWideClassName}>
        <DialogHeader>
          <DialogTitle>{dialogModel.mode === "create" ? "ユーザーを追加" : "ユーザーを編集"}</DialogTitle>
        </DialogHeader>
        <div className={dialogModel.modalBodyClassName}>
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[160px_1fr] md:items-center">
              <div className="text-sm font-medium text-muted-foreground">ユーザーID</div>
              <Input
                value={dialogModel.mode === "create" ? newUserId : dialogModel.editingUser?.id ?? ""}
                onChange={(e) => setNewUserId(e.target.value)}
                placeholder="例: admin2"
                disabled={dialogModel.mode === "edit"}
              />
              <div className="text-sm font-medium text-muted-foreground">表示名</div>
              <Input
                value={dialogModel.mode === "create" ? newUserName : editUserName}
                onChange={(e) =>
                  dialogModel.mode === "create" ? setNewUserName(e.target.value) : setEditUserName(e.target.value)
                }
                placeholder="表示名"
              />
              <div className="text-sm font-medium text-muted-foreground">権限</div>
              <Select
                value={dialogModel.mode === "create" ? newUserRole : editUserRole}
                onValueChange={(value) =>
                  dialogModel.mode === "create"
                    ? setNewUserRole(value as AuthRole)
                    : setEditUserRole(value as AuthRole)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="権限を選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">管理者</SelectItem>
                  <SelectItem value="requester">依頼者</SelectItem>
                  <SelectItem value="viewer">閲覧者</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-sm font-medium text-muted-foreground">パスワード</div>
              <Input
                type="password"
                value={dialogModel.mode === "create" ? newUserPassword : editUserPassword}
                onChange={(e) =>
                  dialogModel.mode === "create"
                    ? setNewUserPassword(e.target.value)
                    : setEditUserPassword(e.target.value)
                }
                placeholder={dialogModel.mode === "create" ? "パスワード" : "変更する場合のみ入力"}
              />
              <div className="text-sm font-medium text-muted-foreground">パスワード（確認）</div>
              <Input
                type="password"
                value={dialogModel.mode === "create" ? newUserPasswordConfirm : editUserPasswordConfirm}
                onChange={(e) =>
                  dialogModel.mode === "create"
                    ? setNewUserPasswordConfirm(e.target.value)
                    : setEditUserPasswordConfirm(e.target.value)
                }
                placeholder={dialogModel.mode === "create" ? "パスワードを再入力" : "パスワードを再入力"}
              />
            </div>
            {dialogModel.mode === "create" && userCreateError ? (
              <div className="text-sm text-destructive">{userCreateError}</div>
            ) : null}
            {dialogModel.mode === "edit" && userEditError ? (
              <div className="text-sm text-destructive">{userEditError}</div>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            キャンセル
          </Button>
          {dialogModel.mode === "create" ? (
            <Button onClick={() => void handleCreate()} disabled={userCreateBusy}>
              {userCreateBusy ? "追加中..." : "追加"}
            </Button>
          ) : (
            <Button onClick={() => void handleUpdate()} disabled={userEditBusy}>
              {userEditBusy ? "保存中..." : "保存"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
