import { useState, useEffect } from "react";
import type { AuthRole, AuthUser, ManagedUser } from "@/types/planning";

type MasterSection = "home" | "items" | "materials" | "users";

interface UseAuthParams {
  masterSection: MasterSection;
  onAfterLogout?: () => void;
}

export interface UseAuthReturn {
  // 認証ステート
  authUser: AuthUser | null;
  setAuthUser: React.Dispatch<React.SetStateAction<AuthUser | null>>;
  authLoading: boolean;
  authError: string | null;
  // ログインフォーム
  loginId: string;
  setLoginId: React.Dispatch<React.SetStateAction<string>>;
  loginPassword: string;
  setLoginPassword: React.Dispatch<React.SetStateAction<string>>;
  loginBusy: boolean;
  loginError: string | null;
  // CSRF
  csrfToken: string;
  setCsrfToken: React.Dispatch<React.SetStateAction<string>>;
  withCsrfHeader: (headers?: Record<string, string>) => Record<string, string>;
  // ユーザー管理
  managedUsers: ManagedUser[];
  managedUsersLoading: boolean;
  managedUsersError: string | null;
  setManagedUsersError: React.Dispatch<React.SetStateAction<string | null>>;
  managedUsersNote: string | null;
  setManagedUsersNote: React.Dispatch<React.SetStateAction<string | null>>;
  userModalMode: "create" | "edit";
  setUserModalMode: React.Dispatch<React.SetStateAction<"create" | "edit">>;
  isUserModalOpen: boolean;
  setIsUserModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  editingUser: ManagedUser | null;
  setEditingUser: React.Dispatch<React.SetStateAction<ManagedUser | null>>;
  // 権限フラグ
  isAdmin: boolean;
  isRequester: boolean;
  isViewer: boolean;
  canEditBlocks: boolean;
  canImportDailyStock: boolean;
  canManageMaster: boolean;
  canUseChat: boolean;
  canExportJson: boolean;
  isReadOnly: boolean;
  authRoleLabel: string;
  // アクション
  handleLogin: () => Promise<void>;
  handleLogout: () => Promise<void>;
  fetchManagedUsers: () => Promise<void>;
  handleCreateManagedUser: (payload: {
    id: string;
    name: string;
    role: AuthRole;
    password: string;
  }) => Promise<{ error?: string } | undefined>;
  handleUpdateManagedUser: (payload: {
    id: string;
    name: string;
    role: AuthRole;
    password?: string;
  }) => Promise<{ error?: string } | undefined>;
  handleDeleteManagedUser: (user: ManagedUser) => Promise<void>;
  openCreateManagedUserModal: () => void;
  openEditManagedUserModal: (user: ManagedUser) => void;
  resolveOperatorName: () => string;
}

const AUTH_ROLE_LABELS: Record<AuthRole, string> = {
  admin: "管理者",
  requester: "依頼者",
  viewer: "閲覧者",
};

export function useAuth({ masterSection, onAfterLogout }: UseAuthParams): UseAuthReturn {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [csrfToken, setCsrfToken] = useState("");

  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [managedUsersLoading, setManagedUsersLoading] = useState(false);
  const [managedUsersError, setManagedUsersError] = useState<string | null>(null);
  const [managedUsersNote, setManagedUsersNote] = useState<string | null>(null);
  const [userModalMode, setUserModalMode] = useState<"create" | "edit">("create");
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);

  // 権限
  const isAdmin = authUser?.role === "admin";
  const isRequester = authUser?.role === "requester";
  const isViewer = authUser?.role === "viewer";
  const canEditBlocks = isAdmin || isRequester;
  const canImportDailyStock = isAdmin || isRequester;
  const canManageMaster = isAdmin;
  const canUseChat = isAdmin;
  const canExportJson = isAdmin;
  const isReadOnly = isViewer;
  const authRoleLabel = authUser ? (AUTH_ROLE_LABELS[authUser.role] ?? "") : "";

  const withCsrfHeader = (headers: Record<string, string> = {}): Record<string, string> => {
    if (!csrfToken) return headers;
    return { ...headers, "X-CSRF-Token": csrfToken };
  };

  const fetchCsrfToken = async () => {
    const response = await fetch("/api/auth/csrf");
    if (!response.ok) {
      throw new Error("CSRFトークンの取得に失敗しました。");
    }
    const payload = (await response.json()) as { csrfToken?: string };
    setCsrfToken(typeof payload.csrfToken === "string" ? payload.csrfToken : "");
  };

  // 初回マウント時に認証ユーザーを取得
  useEffect(() => {
    let cancelled = false;
    const loadAuthUser = async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          if (!cancelled) setAuthUser(null);
          return;
        }
        const payload = (await response.json()) as { user?: AuthUser };
        if (!cancelled) {
          setAuthUser(payload.user ?? null);
          try {
            await fetchCsrfToken();
          } catch {
            setCsrfToken("");
          }
        }
      } catch {
        if (!cancelled) {
          setAuthError("認証情報の取得に失敗しました。");
          setAuthUser(null);
        }
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    };
    void loadAuthUser();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ユーザー管理セクションを開いた時にユーザー一覧を取得
  useEffect(() => {
    if (!authUser || !canManageMaster || masterSection !== "users") return;
    let cancelled = false;
    const load = async () => {
      setManagedUsersLoading(true);
      setManagedUsersError(null);
      try {
        const response = await fetch("/api/admin/users");
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "ユーザー一覧の取得に失敗しました。");
        }
        const payload = (await response.json()) as { users?: ManagedUser[] };
        if (!cancelled) setManagedUsers(payload.users ?? []);
      } catch (error) {
        console.error(error);
        if (!cancelled) setManagedUsersError("ユーザー一覧の取得に失敗しました。");
      } finally {
        if (!cancelled) setManagedUsersLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authUser, canManageMaster, masterSection]);

  const fetchManagedUsers = async () => {
    if (!canManageMaster) return;
    setManagedUsersLoading(true);
    setManagedUsersError(null);
    try {
      const response = await fetch("/api/admin/users");
      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || "ユーザー一覧の取得に失敗しました。");
      }
      const payload = (await response.json()) as { users?: ManagedUser[] };
      setManagedUsers(payload.users ?? []);
    } catch (error) {
      console.error(error);
      setManagedUsersError("ユーザー一覧の取得に失敗しました。");
    } finally {
      setManagedUsersLoading(false);
    }
  };

  const handleLogin = async () => {
    setLoginBusy(true);
    setLoginError(null);
    setAuthError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: loginId, password: loginPassword }),
      });
      if (!response.ok) {
        const message = await response.text();
        setLoginError(message || "ログインに失敗しました。");
        return;
      }
      const payload = (await response.json()) as { user?: AuthUser };
      setAuthUser(payload.user ?? null);
      await fetchCsrfToken();
      setLoginId("");
      setLoginPassword("");
    } catch {
      setLoginError("ログインに失敗しました。");
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: withCsrfHeader() });
    } finally {
      setAuthUser(null);
      setCsrfToken("");
      onAfterLogout?.();
    }
  };

  const handleCreateManagedUser = async (payload: {
    id: string;
    name: string;
    role: AuthRole;
    password: string;
  }): Promise<{ error?: string } | undefined> => {
    if (!canManageMaster) return { error: "ユーザーの追加に失敗しました。" };
    setManagedUsersNote(null);
    try {
      const trimmedId = payload.id.trim();
      const trimmedName = payload.name.trim();
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          id: trimmedId,
          name: trimmedName,
          role: payload.role,
          password: payload.password,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        return { error: message || "ユーザーの追加に失敗しました。" };
      }
      setManagedUsersNote("ユーザーを追加しました。");
      await fetchManagedUsers();
    } catch (error) {
      console.error(error);
      return { error: "ユーザーの追加に失敗しました。" };
    }
  };

  const handleUpdateManagedUser = async (payload: {
    id: string;
    name: string;
    role: AuthRole;
    password?: string;
  }): Promise<{ error?: string } | undefined> => {
    if (!canManageMaster) return { error: "ユーザーの更新に失敗しました。" };
    setManagedUsersNote(null);
    try {
      const trimmedName = payload.name.trim();
      const response = await fetch("/api/admin/users", {
        method: "PUT",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          id: payload.id,
          name: trimmedName,
          role: payload.role,
          password: payload.password || undefined,
        }),
      });
      if (!response.ok) {
        const message = await response.text();
        return { error: message || "ユーザーの更新に失敗しました。" };
      }
      setIsUserModalOpen(false);
      setEditingUser(null);
      setManagedUsersNote("ユーザー情報を更新しました。");
      await fetchManagedUsers();
    } catch (error) {
      console.error(error);
      return { error: "ユーザーの更新に失敗しました。" };
    }
  };

  const handleDeleteManagedUser = async (user: ManagedUser) => {
    if (!canManageMaster) return;
    setManagedUsersNote(null);
    if (!window.confirm(`ユーザー「${user.name}」を削除しますか？`)) return;
    try {
      const response = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({ id: user.id }),
      });
      if (!response.ok) {
        const message = await response.text();
        setManagedUsersError(message || "ユーザーの削除に失敗しました。");
        return;
      }
      setManagedUsersNote("ユーザーを削除しました。");
      await fetchManagedUsers();
    } catch (error) {
      console.error(error);
      setManagedUsersError("ユーザーの削除に失敗しました。");
    }
  };

  const openCreateManagedUserModal = () => {
    setUserModalMode("create");
    setEditingUser(null);
    setIsUserModalOpen(true);
  };

  const openEditManagedUserModal = (user: ManagedUser) => {
    setUserModalMode("edit");
    setEditingUser(user);
    setIsUserModalOpen(true);
  };

  const resolveOperatorName = () => {
    const displayName = authUser?.name?.trim() ?? "";
    if (displayName) return displayName;
    const fallbackId = authUser?.id?.trim() ?? "";
    return fallbackId || "未設定";
  };

  return {
    authUser,
    setAuthUser,
    authLoading,
    authError,
    loginId,
    setLoginId,
    loginPassword,
    setLoginPassword,
    loginBusy,
    loginError,
    csrfToken,
    setCsrfToken,
    withCsrfHeader,
    managedUsers,
    managedUsersLoading,
    managedUsersError,
    setManagedUsersError,
    managedUsersNote,
    setManagedUsersNote,
    userModalMode,
    setUserModalMode,
    isUserModalOpen,
    setIsUserModalOpen,
    editingUser,
    setEditingUser,
    isAdmin,
    isRequester,
    isViewer,
    canEditBlocks,
    canImportDailyStock,
    canManageMaster,
    canUseChat,
    canExportJson,
    isReadOnly,
    authRoleLabel,
    handleLogin,
    handleLogout,
    fetchManagedUsers,
    handleCreateManagedUser,
    handleUpdateManagedUser,
    handleDeleteManagedUser,
    openCreateManagedUserModal,
    openEditManagedUserModal,
    resolveOperatorName,
  };
}
