import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ItemDialogCommitPayload } from "@/features/manufacturing/components/dialogs/ItemDialog";
import { ManufacturingPlanLayout } from "@/features/manufacturing/components/ManufacturingPlanLayout";
import { ManufacturingPlanDialogs } from "@/features/manufacturing/components/ManufacturingPlanDialogs";
import { ImportView } from "@/features/manufacturing/views/ImportView";
import { InventoryView } from "@/features/manufacturing/views/InventoryView";
import { LoginView } from "@/features/manufacturing/views/LoginView";
import { ManualView } from "@/features/manufacturing/views/ManualView";
import { MasterView } from "@/features/manufacturing/views/MasterView";
import { ScheduleView } from "@/features/manufacturing/views/ScheduleView";
import {
  DAILY_STOCK_EXPORT_HEADERS,
  DAILY_STOCK_HEADERS,
  DAYS_IN_WEEK,
  DEFAULT_IMPORT_HEADER_OVERRIDES,
  DEFAULT_ITEM_UNIT,
  DEFAULT_MATERIAL_UNIT,
  DEFAULT_PACKAGING_EFFICIENCY,
  DEFAULT_SAFETY_STOCK_COEFFICIENT,
  DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS,
  DEFAULT_TIMEZONE,
  ITEM_HEADERS,
  ITEM_MASTER_EXPORT_HEADERS,
  MATERIAL_HEADERS,
  MATERIAL_MASTER_EXPORT_HEADERS,
  SAMPLE_ITEMS,
  SAMPLE_MATERIALS,
} from "@/constants/planning";
import { buildCalendarDays, buildDefaultCalendarDays, extendCalendarDaysTo } from "@/lib/calendar";
import {
  toISODate,
  addDays,
  diffDays,
  getDefaultWeekStart,
  parseISODateJST,
  toMD,
  toWeekday,
} from "@/lib/datetime";
import { downloadCsvFile, downloadTextFile } from "@/lib/export/csv";
import { buildExportPayload } from "@/lib/export/payload";
import { calcMaterials, durationLabel, itemCodeKey } from "@/lib/format";
import {
  buildCalendarSlots,
  buildPlanSnapshot,
  buildSlotHeaderLabels,
  clamp,
  clampToWorkingSlot,
  convertSlotIndex,
  convertSlotLength,
  endDayIndex,
  slotBoundaryToDateTime,
  slotIndexFromDateTime,
  slotLabelFromCalendar,
  slotToDateTime,
  xToSlot,
} from "@/lib/slots";
import {
  asItemUnit,
  asPlanningPolicy,
  asRecipeUnit,
  asSafetyStockAutoEnabled,
  DEFAULT_BLOCKS,
  extractJsonPayload,
  findHeaderIndex,
  isEmptyRow,
  mergeHeaderCandidates,
  mergeMaterialsFromItems,
  normalizeDateInput,
  normalizeImportHeaderOverrides,
  normalizeNumberInput,
  parsePlanPayload,
  safeNumber,
  uid,
} from "@/lib/sanitize";
import type {
  AuthRole,
  AuthUser,
  Block,
  CalendarDay,
  ChatAction,
  ChatMessage,
  ChatResponsePayload,
  DailyStockEntry,
  DailyStocksResponse,
  Density,
  DragKind,
  DragState,
  ImportHeaderOverrides,
  Item,
  ItemImportRow,
  ManagedUser,
  Material,
  MaterialImportRow,
  PlanPayload,
  PlanSnapshot,
  RecipeLine,
  RecipeUnit,
} from "@/types/planning";

/**
 * 製造計画ガントチャート（D&D + リサイズ + レシピ編集 + 日区切り強調 + 日次在庫 + JSONエクスポート）
 *
 * 追加機能（直近の要件）
 * - JSONエクスポート：生成AIへAPI連携する前提の入力データ（品目/レシピ/ブロック/週/スロット定義等）を出力
 *
 * 本ファイルは App.tsx で動作することを前提に、
 * JSX の閉じ漏れや JSDoc/JSX のパーサ誤検知を避けるため、
 * 型は TypeScript の interface/type を使用しています。
 */

export default function ManufacturingPlanGanttApp(): JSX.Element {
  const [navOpen, setNavOpen] = useState(false);
  const [activeView, setActiveView] = useState<"schedule" | "inventory" | "master" | "import" | "manual">(
    "schedule"
  );
  const [masterSection, setMasterSection] = useState<"home" | "items" | "materials" | "users">("home");
  const [manualAudience, setManualAudience] = useState<"user" | "admin">("user");
  const [planWeekStart, setPlanWeekStart] = useState<Date>(() => getDefaultWeekStart());
  const [viewWeekStart, setViewWeekStart] = useState<Date>(() => getDefaultWeekStart());

  const [planDensity, setPlanDensity] = useState<Density>("hour");
  const [viewDensity, setViewDensity] = useState<Density>("hour");
  const [planCalendarDays, setPlanCalendarDays] = useState<CalendarDay[]>(() =>
    buildDefaultCalendarDays(getDefaultWeekStart())
  );

  // 実運用ではユーザー設定から取得する想定
  const timezone = DEFAULT_TIMEZONE;

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

  const [materialsMaster, setMaterialsMaster] = useState<Material[]>(SAMPLE_MATERIALS);
  const [items, setItems] = useState<Item[]>(SAMPLE_ITEMS);
  const [dailyStocks, setDailyStocks] = useState<DailyStockEntry[]>([]);
  const [dailyStockUpdatedAt, setDailyStockUpdatedAt] = useState<string | null>(null);
  const [dailyStockImportNote, setDailyStockImportNote] = useState<string | null>(null);
  const [itemMasterImportNote, setItemMasterImportNote] = useState<string | null>(null);
  const [materialMasterImportNote, setMaterialMasterImportNote] = useState<string | null>(null);
  const [dailyStockImportError, setDailyStockImportError] = useState<string | null>(null);
  const [itemMasterImportError, setItemMasterImportError] = useState<string | null>(null);
  const [materialMasterImportError, setMaterialMasterImportError] = useState<string | null>(null);
  const [dailyStockImportFile, setDailyStockImportFile] = useState<File | null>(null);
  const [itemMasterImportFile, setItemMasterImportFile] = useState<File | null>(null);
  const [materialMasterImportFile, setMaterialMasterImportFile] = useState<File | null>(null);
  const [dailyStockInputKey, setDailyStockInputKey] = useState(0);
  const [itemMasterInputKey, setItemMasterInputKey] = useState(0);
  const [materialMasterInputKey, setMaterialMasterInputKey] = useState(0);
  const [dailyStockHeaderOverrides, setDailyStockHeaderOverrides] = useState(
    DEFAULT_IMPORT_HEADER_OVERRIDES.dailyStock
  );
  const [importHeaderSaveNote, setImportHeaderSaveNote] = useState<string | null>(null);
  const [importHeaderSaveError, setImportHeaderSaveError] = useState<string | null>(null);
  const [importHeaderSaveBusy, setImportHeaderSaveBusy] = useState(false);
  const [itemDialogState, setItemDialogState] = useState<{
    open: boolean;
    mode: "create" | "edit";
    editingItemId: string | null;
  }>({
    open: false,
    mode: "create",
    editingItemId: null,
  });

  const viewStartISO = toISODate(viewWeekStart);
  const planStartISO = planCalendarDays[0]?.date ?? toISODate(planWeekStart);
  const viewStartOffsetDays = useMemo(() => diffDays(planStartISO, viewStartISO), [planStartISO, viewStartISO]);
  const isViewWithinPlanRange =
    viewStartOffsetDays >= 0 && viewStartOffsetDays + DAYS_IN_WEEK <= planCalendarDays.length;

  const viewCalendarDays = useMemo(() => {
    if (!isViewWithinPlanRange) return buildDefaultCalendarDays(viewWeekStart);
    return planCalendarDays.slice(viewStartOffsetDays, viewStartOffsetDays + DAYS_IN_WEEK);
  }, [isViewWithinPlanRange, planCalendarDays, viewStartOffsetDays, viewWeekStart]);

  const viewCalendar = useMemo(
    () => buildCalendarSlots(viewCalendarDays, viewDensity),
    [viewCalendarDays, viewDensity]
  );
  const weekDates = useMemo(() => viewCalendarDays.map((day) => day.date), [viewCalendarDays]);
  const slotsPerDay = viewCalendar.slotsPerDay;
  const viewOffsetSlots = viewStartOffsetDays * slotsPerDay;
  const slotHeaderLabels = useMemo(
    () => buildSlotHeaderLabels(viewCalendar.hoursByDay, viewDensity),
    [viewCalendar.hoursByDay, viewDensity]
  );

  const planCalendar = useMemo(
    () => buildCalendarSlots(planCalendarDays, planDensity),
    [planCalendarDays, planDensity]
  );
  const planWeekDates = useMemo(() => planCalendarDays.map((day) => day.date), [planCalendarDays]);
  const planSlotsPerDay = planCalendar.slotsPerDay;
  const planSlotCount = planCalendar.slotCount;
  const planSlotIndexToLabel = useMemo(
    () =>
      Array.from({ length: planSlotCount }, (_, i) =>
        slotLabelFromCalendar({
          density: planDensity,
          calendarDays: planCalendarDays,
          hoursByDay: planCalendar.hoursByDay,
          slotIndex: i,
        })
      ),
    [planCalendar.hoursByDay, planCalendarDays, planDensity, planSlotCount]
  );

  const isPlanWeekView = isViewWithinPlanRange;

  useEffect(() => {
    if (!planCalendarDays.length) return;
    const currentPlanStartISO = planCalendarDays[0].date;
    const currentPlanEndISO = planCalendarDays[planCalendarDays.length - 1].date;
    const viewEndISO = toISODate(addDays(viewWeekStart, DAYS_IN_WEEK - 1));

    if (viewStartISO < currentPlanStartISO) {
      const daysToPrepend = diffDays(viewStartISO, currentPlanStartISO);
      if (daysToPrepend > 0) {
        const viewStartDate = parseISODateJST(viewStartISO) ?? new Date(viewStartISO);
        const newDays = buildCalendarDays(viewStartDate, daysToPrepend);
        const shiftSlots = daysToPrepend * planSlotsPerDay;
        setPlanCalendarDays((prev) => [...newDays, ...prev]);
        const planWeekStartDate = parseISODateJST(viewStartISO) ?? new Date(viewStartISO);
        setPlanWeekStart(planWeekStartDate);
        if (shiftSlots > 0) {
          setBlocks((prev) => prev.map((b) => ({ ...b, start: b.start + shiftSlots })));
        }
      }
      return;
    }

    if (viewEndISO > currentPlanEndISO) {
      const daysToAppend = diffDays(currentPlanEndISO, viewEndISO);
      if (daysToAppend > 0) {
        const appendStartBase = parseISODateJST(currentPlanEndISO) ?? new Date(currentPlanEndISO);
        const appendStart = addDays(appendStartBase, 1);
        const newDays = buildCalendarDays(appendStart, daysToAppend);
        setPlanCalendarDays((prev) => [...prev, ...newDays]);
      }
    }
  }, [planCalendarDays, planSlotsPerDay, viewStartISO, viewWeekStart]);

  const geminiModel =
    (import.meta.env.VITE_GEMINI_MODEL as string | undefined)?.trim() || "gemini-2.5-flash";

  const [blocks, setBlocks] = useState<Block[]>(() => DEFAULT_BLOCKS());

  const [isPlanLoaded, setIsPlanLoaded] = useState(false);

  const [openPlan, setOpenPlan] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [formAmount, setFormAmount] = useState("0");
  const [formMemo, setFormMemo] = useState("");
  const [formApproved, setFormApproved] = useState(false);

  const [openRecipe, setOpenRecipe] = useState(false);
  const [activeRecipeItemId, setActiveRecipeItemId] = useState<string | null>(null);
  const [recipeDraft, setRecipeDraft] = useState<RecipeLine[]>([]);

  const isAdmin = authUser?.role === "admin";
  const isRequester = authUser?.role === "requester";
  const isViewer = authUser?.role === "viewer";
  const canEditBlocks = isAdmin || isRequester;
  const canImportDailyStock = isAdmin || isRequester;
  const canManageMaster = isAdmin;
  const canUseChat = isAdmin;
  const canExportJson = isAdmin;
  const authRoleLabelMap: Record<NonNullable<AuthUser>["role"], string> = {
    admin: "管理者",
    requester: "依頼者",
    viewer: "閲覧者",
  };
  const authRoleLabel = authUser ? authRoleLabelMap[authUser.role] : "";
  const readOnlyMessage = "権限がないため操作できません。";
  const resolveOperatorName = () => {
    const displayName = authUser?.name?.trim() ?? "";
    if (displayName) return displayName;
    const fallbackId = authUser?.id?.trim() ?? "";
    return fallbackId || "未設定";
  };


  const withCsrfHeader = (headers: Record<string, string> = {}) => {
    if (!csrfToken) return headers;
    return {
      ...headers,
      "X-CSRF-Token": csrfToken,
    };
  };

  const fetchCsrfToken = async () => {
    const response = await fetch("/api/auth/csrf");
    if (!response.ok) {
      throw new Error("CSRFトークンの取得に失敗しました。");
    }
    const payload = (await response.json()) as { csrfToken?: string };
    setCsrfToken(typeof payload.csrfToken === "string" ? payload.csrfToken : "");
  };

  useEffect(() => {
    let cancelled = false;
    const loadAuthUser = async () => {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          if (!cancelled) {
            setAuthUser(null);
          }
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
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    };
    void loadAuthUser();
    return () => {
      cancelled = true;
    };
  }, []);

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
        if (!cancelled) {
          setManagedUsers(payload.users ?? []);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setManagedUsersError("ユーザー一覧の取得に失敗しました。");
        }
      } finally {
        if (!cancelled) {
          setManagedUsersLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [authUser, canManageMaster, masterSection]);

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

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: withCsrfHeader() });
    } finally {
      setAuthUser(null);
      setCsrfToken("");
      setActiveView("schedule");
    }
  };
  const [materialDialogState, setMaterialDialogState] = useState<{
    open: boolean;
    editingMaterialId: string | null;
  }>({
    open: false,
    editingMaterialId: null,
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [constraintsOpen, setConstraintsOpen] = useState(false);
  const [constraintsText, setConstraintsText] = useState("");
  const [constraintsDraft, setConstraintsDraft] = useState("");
  const [constraintsBusy, setConstraintsBusy] = useState(false);
  const [constraintsError, setConstraintsError] = useState<string | null>(null);
  const [geminiHorizonDays, setGeminiHorizonDays] = useState(30);
  const [geminiHorizonDaysDraft, setGeminiHorizonDaysDraft] = useState("30");
  const [pendingBlockId, setPendingBlockId] = useState<string | null>(null);

  const modalBodyClassName = "px-6 py-4";
  const modalWideClassName = "max-w-2xl";

  const handleConstraintsDraftChange = (value: string) => {
    setConstraintsDraft(value);
  };

  const handleGeminiHorizonDaysDraftChange = (value: string) => {
    setGeminiHorizonDaysDraft(value);
  };

  const constraintsDialogModel = {
    constraintsDraft,
    geminiHorizonDaysDraft,
    constraintsError,
    constraintsBusy,
    canEdit: canUseChat,
  };

  const constraintsDialogActions = {
    onChangeConstraintsDraft: handleConstraintsDraftChange,
    onChangeGeminiHorizonDaysDraft: handleGeminiHorizonDaysDraftChange,
  };

  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const laneRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const materialMap = useMemo(() => {
    return new Map(materialsMaster.map((m) => [m.id, m]));
  }, [materialsMaster]);

  const itemMap = useMemo(() => {
    return new Map(items.map((item) => [item.id, item]));
  }, [items]);

  const itemOptions = useMemo(
    () =>
      items.map((item) => {
        const label = item.publicId ? `${item.name} (${item.publicId})` : item.name;
        return {
          value: item.id,
          label,
          description: item.unit,
          keywords: `${item.name} ${item.publicId ?? ""} ${item.id}`,
        };
      }),
    [items]
  );

  const materialOptions = useMemo(
    () =>
      materialsMaster.map((material) => ({
        value: material.id,
        label: `${material.name} (${material.id})`,
        description: material.unit,
        keywords: `${material.name} ${material.id}`,
      })),
    [materialsMaster]
  );

  const itemKeyMap = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => {
      const key = itemCodeKey(item);
      map.set(item.id, item.id);
      map.set(key, item.id);
    });
    return map;
  }, [items]);

  const dailyStockMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    dailyStocks.forEach((entry) => {
      if (!entry.itemId || !entry.date) return;
      if (!map.has(entry.itemId)) {
        map.set(entry.itemId, new Map());
      }
      map.get(entry.itemId)?.set(entry.date, entry.stock);
    });
    return map;
  }, [dailyStocks]);

  const dailyStockEntryMap = useMemo(() => {
    const map = new Map<string, Map<string, DailyStockEntry>>();
    dailyStocks.forEach((entry) => {
      if (!entry.itemId || !entry.date) return;
      if (!map.has(entry.itemId)) {
        map.set(entry.itemId, new Map());
      }
      map.get(entry.itemId)?.set(entry.date, entry);
    });
    return map;
  }, [dailyStocks]);

  const inventoryDates = useMemo(() => {
    const dates = Array.from(new Set(dailyStocks.map((entry) => entry.date).filter(Boolean)));
    dates.sort();
    return dates;
  }, [dailyStocks]);

  const inventoryItems = useMemo(() => {
    const itemIds = new Set(dailyStocks.map((entry) => entry.itemId));
    return items.filter((item) => itemIds.has(item.id));
  }, [dailyStocks, items]);

  const activeBlock = useMemo(() => {
    if (!activeBlockId) return null;
    return blocks.find((b) => b.id === activeBlockId) ?? null;
  }, [activeBlockId, blocks]);

  const canEditActiveBlock = isAdmin || (isRequester && !activeBlock?.approved);

  const [formItemId, setFormItemId] = useState("");

  const activeItem = useMemo(() => {
    if (formItemId) {
      return itemMap.get(formItemId) ?? null;
    }
    if (!activeBlock) return null;
    return itemMap.get(activeBlock.itemId) ?? null;
  }, [activeBlock, formItemId, itemMap]);

  const materials = useMemo(() => {
    if (!activeItem) return [];
    const amount = Math.max(0, safeNumber(formAmount));
    return calcMaterials(activeItem, amount, materialMap);
  }, [activeItem, formAmount, materialMap]);

  const activeManufactureDate = useMemo(() => {
    if (!activeBlock) return null;
    const dateTime = slotToDateTime(
      activeBlock.start,
      planCalendarDays,
      planCalendar.rawHoursByDay,
      planCalendar.slotsPerDay
    );
    return dateTime ? toISODate(dateTime) : null;
  }, [activeBlock, planCalendar.rawHoursByDay, planCalendar.slotsPerDay, planCalendarDays]);

  const activeExpirationDate = useMemo(() => {
    if (!activeItem || !activeManufactureDate) return null;
    const base = new Date(`${activeManufactureDate}T00:00:00`);
    if (Number.isNaN(base.getTime())) return null;
    return toISODate(addDays(base, activeItem.shelfLifeDays ?? 0));
  }, [activeItem, activeManufactureDate]);

  const blockDetailDialogModel = {
    open: openPlan,
    modalBodyClassName,
    planDensity,
    planCalendarDays,
    planHoursByDay: planCalendar.hoursByDay,
    planSlotCount,
    activeBlock,
    activeItem,
    items,
    itemOptions,
    materials,
    formItemId,
    formAmount,
    formMemo,
    formApproved,
    activeManufactureDate,
    activeExpirationDate,
    canEdit: canEditActiveBlock,
    canApprove: isAdmin,
  };

  const blockDetailDialogActions = {
    onChangeItemId: setFormItemId,
    onChangeAmount: setFormAmount,
    onChangeMemo: setFormMemo,
    setFormApproved,
    setBlocks,
    setActiveBlockId,
    setPendingBlockId,
  };

  const activeRecipeItem = useMemo(() => {
    if (!activeRecipeItemId) return null;
    return itemMap.get(activeRecipeItemId) ?? null;
  }, [activeRecipeItemId, itemMap]);

  const shiftWeek = (deltaDays: number) => {
    setViewWeekStart((prev) => {
      const d = new Date(prev);
      d.setDate(prev.getDate() + deltaDays);
      return d;
    });
  };

  const readFirstSheetRows = async (file: File): Promise<unknown[][]> => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][];
    return rows ?? [];
  };

  const runExcelImportWithFeedback = async <TResult, TSummary = void>({
    file,
    parseRows,
    onSuccess,
    buildNote,
    setNote,
    setError,
    setInputKey,
    fallbackErrorMessage,
  }: {
    file: File;
    parseRows: (rows: unknown[][]) => TResult;
    onSuccess: (result: TResult) => Promise<TSummary> | TSummary;
    buildNote: (result: TResult, summary: TSummary) => string;
    setNote: React.Dispatch<React.SetStateAction<string | null>>;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    setInputKey?: React.Dispatch<React.SetStateAction<number>>;
    fallbackErrorMessage: string;
  }): Promise<boolean> => {
    setError(null);
    setNote(null);
    try {
      const rows = await readFirstSheetRows(file);
      const result = parseRows(rows);
      const summary = await onSuccess(result);
      setNote(buildNote(result, summary));
      if (setInputKey) {
        setInputKey((prev) => prev + 1);
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : fallbackErrorMessage;
      setError(message);
      return false;
    }
  };

  const parseDailyStockRows = (rows: unknown[][]) => {
    if (!rows.length) {
      throw new Error("シートが空です。");
    }
    const headers = rows[0] ?? [];
    const dateIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(DAILY_STOCK_HEADERS.date, dailyStockHeaderOverrides.date)
    );
    const itemIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(DAILY_STOCK_HEADERS.itemCode, dailyStockHeaderOverrides.itemCode)
    );
    const stockIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(DAILY_STOCK_HEADERS.stock, dailyStockHeaderOverrides.stock)
    );
    const shippedIndex = findHeaderIndex(
      headers,
      mergeHeaderCandidates(DAILY_STOCK_HEADERS.shipped, dailyStockHeaderOverrides.shipped)
    );
    if (dateIndex < 0 || itemIndex < 0 || stockIndex < 0) {
      throw new Error("日別在庫の必須列（日付/品目コード/在庫数）が見つかりません。");
    }

    const next: DailyStockEntry[] = [];
    let missingItem = 0;
    let invalidRows = 0;

    rows.slice(1).forEach((row) => {
      if (!row || isEmptyRow(row)) return;
      const date = normalizeDateInput(row[dateIndex]);
      const itemCode = String(row[itemIndex] ?? "").trim();
      const stock = normalizeNumberInput(row[stockIndex]);
      const shipped = shippedIndex >= 0 ? normalizeNumberInput(row[shippedIndex]) ?? 0 : 0;
      if (!date || !itemCode || stock === null) {
        invalidRows += 1;
        return;
      }
      const itemId = itemKeyMap.get(itemCode);
      if (!itemId) {
        missingItem += 1;
        return;
      }
      next.push({ date, itemId, itemCode, stock, shipped });
    });

    return { entries: next, missingItem, invalidRows };
  };

  const mergeDailyStockEntries = (base: DailyStockEntry[], incoming: DailyStockEntry[]) => {
    const merged = new Map<string, DailyStockEntry>();
    const toKey = (entry: DailyStockEntry) => `${entry.date}::${entry.itemCode}`;
    base.forEach((entry) => {
      merged.set(toKey(entry), entry);
    });
    incoming.forEach((entry) => {
      merged.set(toKey(entry), entry);
    });
    return Array.from(merged.values()).sort(
      (a, b) => a.date.localeCompare(b.date) || a.itemCode.localeCompare(b.itemCode)
    );
  };

  const parseItemMasterRows = (rows: unknown[][]) => {
    if (!rows.length) {
      throw new Error("シートが空です。");
    }
    const headers = rows[0] ?? [];
    const codeIndex = findHeaderIndex(headers, ITEM_HEADERS.code);
    const nameIndex = findHeaderIndex(headers, ITEM_HEADERS.name);
    if (codeIndex < 0 || nameIndex < 0) {
      throw new Error("品目マスタの必須列（品目コード/品目名）が見つかりません。");
    }
    const unitIndex = findHeaderIndex(headers, ITEM_HEADERS.unit);
    const policyIndex = findHeaderIndex(headers, ITEM_HEADERS.planningPolicy);
    const safetyStockIndex = findHeaderIndex(headers, ITEM_HEADERS.safetyStock);
    const autoCalcIndex = findHeaderIndex(headers, ITEM_HEADERS.safetyStockAutoEnabled);
    const lookbackIndex = findHeaderIndex(headers, ITEM_HEADERS.safetyStockLookbackDays);
    const coefficientIndex = findHeaderIndex(headers, ITEM_HEADERS.safetyStockCoefficient);
    const shelfLifeIndex = findHeaderIndex(headers, ITEM_HEADERS.shelfLifeDays);
    const efficiencyIndex = findHeaderIndex(headers, ITEM_HEADERS.productionEfficiency);
    const packagingEfficiencyIndex = findHeaderIndex(headers, ITEM_HEADERS.packagingEfficiency);
    const notesIndex = findHeaderIndex(headers, ITEM_HEADERS.notes);

    const next: ItemImportRow[] = [];
    let invalidRows = 0;
    let duplicateCodes = 0;
    const seen = new Set<string>();

    rows.slice(1).forEach((row) => {
      if (!row || isEmptyRow(row)) return;
      const code = String(row[codeIndex] ?? "").trim();
      const name = String(row[nameIndex] ?? "").trim();
      if (!code || !name) {
        invalidRows += 1;
        return;
      }
      if (seen.has(code)) {
        duplicateCodes += 1;
        return;
      }
      seen.add(code);
      const unit = unitIndex >= 0 ? asItemUnit(row[unitIndex]) : DEFAULT_ITEM_UNIT;
      const planningPolicy = policyIndex >= 0 ? asPlanningPolicy(row[policyIndex]) : "make_to_stock";
      const safetyStock = Math.max(0, normalizeNumberInput(row[safetyStockIndex]) ?? 0);
      const safetyStockAutoEnabled = autoCalcIndex >= 0 ? asSafetyStockAutoEnabled(row[autoCalcIndex]) : null;
      const safetyStockLookbackDays =
        lookbackIndex >= 0 ? Math.max(0, normalizeNumberInput(row[lookbackIndex]) ?? 0) : null;
      const safetyStockCoefficient =
        coefficientIndex >= 0 ? Math.max(0, normalizeNumberInput(row[coefficientIndex]) ?? 0) : null;
      const shelfLifeDays = Math.max(0, normalizeNumberInput(row[shelfLifeIndex]) ?? 0);
      const productionEfficiency = Math.max(0, normalizeNumberInput(row[efficiencyIndex]) ?? 0);
      const packagingEfficiency =
        packagingEfficiencyIndex >= 0
          ? Math.max(0, normalizeNumberInput(row[packagingEfficiencyIndex]) ?? 0)
          : null;
      const notes = notesIndex >= 0 ? String(row[notesIndex] ?? "").trim() : "";
      next.push({
        code,
        name,
        unit,
        planningPolicy,
        safetyStock,
        safetyStockAutoEnabled,
        safetyStockLookbackDays,
        safetyStockCoefficient,
        shelfLifeDays,
        productionEfficiency,
        packagingEfficiency,
        notes,
      });
    });

    return { entries: next, invalidRows, duplicateCodes };
  };

  const parseMaterialMasterRows = (rows: unknown[][]) => {
    if (!rows.length) {
      throw new Error("シートが空です。");
    }
    const headers = rows[0] ?? [];
    const codeIndex = findHeaderIndex(headers, MATERIAL_HEADERS.code);
    const nameIndex = findHeaderIndex(headers, MATERIAL_HEADERS.name);
    if (codeIndex < 0 || nameIndex < 0) {
      throw new Error("原料マスタの必須列（原料コード/原料名）が見つかりません。");
    }
    const unitIndex = findHeaderIndex(headers, MATERIAL_HEADERS.unit);

    const next: MaterialImportRow[] = [];
    let invalidRows = 0;
    let duplicateCodes = 0;
    const seen = new Set<string>();

    rows.slice(1).forEach((row) => {
      if (!row || isEmptyRow(row)) return;
      const code = String(row[codeIndex] ?? "").trim();
      const name = String(row[nameIndex] ?? "").trim();
      if (!code || !name) {
        invalidRows += 1;
        return;
      }
      if (seen.has(code)) {
        duplicateCodes += 1;
        return;
      }
      seen.add(code);
      const unit = unitIndex >= 0 ? asRecipeUnit(row[unitIndex]) : DEFAULT_MATERIAL_UNIT;
      next.push({ code, name, unit });
    });

    return { entries: next, invalidRows, duplicateCodes };
  };

  const saveDailyStocksToServer = async (entries: DailyStockEntry[]) => {
    const response = await fetch("/api/daily-stocks", {
      method: "POST",
      headers: withCsrfHeader({ "Content-Type": "application/json" }),
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) {
      throw new Error("日別在庫の保存に失敗しました。");
    }
    const payload = (await response.json()) as Partial<DailyStocksResponse>;
    const updatedAtISO = typeof payload.updatedAtISO === "string" ? payload.updatedAtISO : null;
    setDailyStockUpdatedAt(updatedAtISO);
  };

  const saveImportHeaderOverrides = async () => {
    if (!canImportDailyStock) {
      setImportHeaderSaveError(readOnlyMessage);
      return;
    }
    setImportHeaderSaveBusy(true);
    setImportHeaderSaveNote(null);
    setImportHeaderSaveError(null);
    try {
      const response = await fetch("/api/import-headers", {
        method: "POST",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          dailyStock: dailyStockHeaderOverrides,
        } satisfies ImportHeaderOverrides),
      });
      if (!response.ok) {
        throw new Error("ヘッダー指定の保存に失敗しました。");
      }
      setImportHeaderSaveNote("ヘッダー指定を保存しました。");
    } catch {
      setImportHeaderSaveError("ヘッダー指定の保存に失敗しました。");
    } finally {
      setImportHeaderSaveBusy(false);
    }
  };

  const handleDailyStockImport = async (file: File): Promise<boolean> => {
    if (!canImportDailyStock) {
      setDailyStockImportError(readOnlyMessage);
      return false;
    }
    return await runExcelImportWithFeedback({
      file,
      parseRows: parseDailyStockRows,
      onSuccess: async (result) => {
        await saveDailyStocksToServer(result.entries);
        setDailyStocks((prev) => mergeDailyStockEntries(prev, result.entries));
      },
      buildNote: (result) =>
        `日別在庫を${result.entries.length}件取り込みました。` +
        (result.missingItem ? ` (品目未登録:${result.missingItem}件)` : "") +
        (result.invalidRows ? ` (無効行:${result.invalidRows}件)` : ""),
      setNote: setDailyStockImportNote,
      setError: setDailyStockImportError,
      setInputKey: setDailyStockInputKey,
      fallbackErrorMessage: "日別在庫の取り込みに失敗しました。",
    });
  };

  const handleItemMasterImport = async (file: File): Promise<boolean> => {
    if (!canManageMaster) {
      setItemMasterImportError(readOnlyMessage);
      return false;
    }
    return await runExcelImportWithFeedback({
      file,
      parseRows: parseItemMasterRows,
      onSuccess: (result) => {
        const existingByCode = new Map(items.map((item) => [itemCodeKey(item), item]));
        const indexById = new Map(items.map((item, idx) => [item.id, idx]));
        const nextItems = [...items];
        let created = 0;
        let updated = 0;
        result.entries.forEach((row) => {
          const existing = existingByCode.get(row.code);
          if (existing) {
            const updatedItem: Item = {
              ...existing,
              publicId: row.code,
              name: row.name,
              unit: row.unit,
              planningPolicy: row.planningPolicy,
              safetyStock: row.safetyStock,
              safetyStockAutoEnabled: row.safetyStockAutoEnabled ?? existing.safetyStockAutoEnabled,
              safetyStockLookbackDays: row.safetyStockLookbackDays ?? existing.safetyStockLookbackDays,
              safetyStockCoefficient: row.safetyStockCoefficient ?? existing.safetyStockCoefficient,
              shelfLifeDays: row.shelfLifeDays,
              productionEfficiency: row.productionEfficiency,
              packagingEfficiency: row.packagingEfficiency ?? existing.packagingEfficiency,
              notes: row.notes,
            };
            const idx = indexById.get(existing.id);
            if (typeof idx === "number") {
              nextItems[idx] = updatedItem;
            } else {
              nextItems.push(updatedItem);
            }
            updated += 1;
          } else {
            nextItems.push({
              id: uid("i"),
              publicId: row.code,
              name: row.name,
              unit: row.unit,
              planningPolicy: row.planningPolicy,
              safetyStock: row.safetyStock,
              safetyStockAutoEnabled: row.safetyStockAutoEnabled ?? false,
              safetyStockLookbackDays: row.safetyStockLookbackDays ?? DEFAULT_SAFETY_STOCK_LOOKBACK_DAYS,
              safetyStockCoefficient: row.safetyStockCoefficient ?? DEFAULT_SAFETY_STOCK_COEFFICIENT,
              shelfLifeDays: row.shelfLifeDays,
              productionEfficiency: row.productionEfficiency,
              packagingEfficiency: row.packagingEfficiency ?? DEFAULT_PACKAGING_EFFICIENCY,
              notes: row.notes,
              recipe: [],
            });
            created += 1;
          }
        });
        setItems(nextItems);
        return { created, updated };
      },
      buildNote: (result, summary) =>
        `品目マスタを${summary.created + summary.updated}件取り込みました。` +
        ` (新規:${summary.created}件/更新:${summary.updated}件)` +
        (result.duplicateCodes ? ` (重複コード:${result.duplicateCodes}件)` : "") +
        (result.invalidRows ? ` (無効行:${result.invalidRows}件)` : ""),
      setNote: setItemMasterImportNote,
      setError: setItemMasterImportError,
      setInputKey: setItemMasterInputKey,
      fallbackErrorMessage: "品目マスタの取り込みに失敗しました。",
    });
  };

  const handleMaterialMasterImport = async (file: File): Promise<boolean> => {
    if (!canManageMaster) {
      setMaterialMasterImportError(readOnlyMessage);
      return false;
    }
    return await runExcelImportWithFeedback({
      file,
      parseRows: parseMaterialMasterRows,
      onSuccess: (result) => {
        const existingByCode = new Map(materialsMaster.map((material) => [material.id, material]));
        const indexById = new Map(materialsMaster.map((material, idx) => [material.id, idx]));
        const nextMaterials = [...materialsMaster];
        let created = 0;
        let updated = 0;
        result.entries.forEach((row) => {
          const existing = existingByCode.get(row.code);
          if (existing) {
            const updatedMaterial: Material = {
              ...existing,
              id: existing.id,
              name: row.name,
              unit: row.unit,
            };
            const idx = indexById.get(existing.id);
            if (typeof idx === "number") {
              nextMaterials[idx] = updatedMaterial;
            } else {
              nextMaterials.push(updatedMaterial);
            }
            updated += 1;
          } else {
            nextMaterials.push({
              id: row.code,
              name: row.name,
              unit: row.unit,
            });
            created += 1;
          }
        });
        setMaterialsMaster(nextMaterials);
        return { created, updated };
      },
      buildNote: (result, summary) =>
        `原料マスタを${summary.created + summary.updated}件取り込みました。` +
        ` (新規:${summary.created}件/更新:${summary.updated}件)` +
        (result.duplicateCodes ? ` (重複コード:${result.duplicateCodes}件)` : "") +
        (result.invalidRows ? ` (無効行:${result.invalidRows}件)` : ""),
      setNote: setMaterialMasterImportNote,
      setError: setMaterialMasterImportError,
      setInputKey: setMaterialMasterInputKey,
      fallbackErrorMessage: "原料マスタの取り込みに失敗しました。",
    });
  };

  const handleDailyStockImportClick = async () => {
    if (!dailyStockImportFile) {
      setDailyStockImportError("取り込みファイルを選択してください。");
      return;
    }
    const success = await handleDailyStockImport(dailyStockImportFile);
    if (success) {
      setDailyStockImportFile(null);
    }
  };

  const handleItemMasterImportClick = async () => {
    if (!itemMasterImportFile) {
      setItemMasterImportError("取り込みファイルを選択してください。");
      return;
    }
    const success = await handleItemMasterImport(itemMasterImportFile);
    if (success) {
      setItemMasterImportFile(null);
    }
  };

  const handleMaterialMasterImportClick = async () => {
    if (!materialMasterImportFile) {
      setMaterialMasterImportError("取り込みファイルを選択してください。");
      return;
    }
    const success = await handleMaterialMasterImport(materialMasterImportFile);
    if (success) {
      setMaterialMasterImportFile(null);
    }
  };

  const exportDailyStockCsv = () => {
    const rows = [...dailyStocks]
      .sort((a, b) => a.date.localeCompare(b.date) || a.itemCode.localeCompare(b.itemCode))
      .map((entry) => [entry.date, entry.itemCode, entry.stock, entry.shipped]);
    const today = toISODate(new Date());
    downloadCsvFile(`daily-stocks-${today}.csv`, DAILY_STOCK_EXPORT_HEADERS, rows);
  };

  const exportItemMasterCsv = () => {
    const rows = [...items]
      .sort((a, b) => itemCodeKey(a).localeCompare(itemCodeKey(b)))
      .map((item) => [
        itemCodeKey(item),
        item.name,
        item.unit,
        item.planningPolicy,
        item.safetyStock,
        item.safetyStockAutoEnabled ? "対象" : "対象外",
        item.safetyStockLookbackDays,
        item.safetyStockCoefficient,
        item.shelfLifeDays,
        item.productionEfficiency,
        item.packagingEfficiency,
        item.notes,
      ]);
    const today = toISODate(new Date());
    downloadCsvFile(`item-master-${today}.csv`, ITEM_MASTER_EXPORT_HEADERS, rows);
  };

  const exportMaterialMasterCsv = () => {
    const rows = [...materialsMaster]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((material) => [material.id, material.name, material.unit]);
    const today = toISODate(new Date());
    downloadCsvFile(`material-master-${today}.csv`, MATERIAL_MASTER_EXPORT_HEADERS, rows);
  };

  useEffect(() => {
    setBlocks((prev) =>
      prev
        .map((b) => {
          const start = clamp(b.start, 0, planSlotCount - 1);
          const len = clamp(b.len, 1, planSlotCount - start);
          return { ...b, start, len };
        })
        .filter((b) => b.len >= 1)
    );
  }, [planSlotCount]);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    const loadPlan = async () => {
      try {
        const response = await fetch("/api/plan");
        if (!response.ok || response.status === 204) return;
        const raw = (await response.json()) as unknown;
        const payload = parsePlanPayload(raw);
        if (!payload || cancelled) return;

        const parsedWeekStart = parseISODateJST(payload.weekStartISO) ?? new Date(payload.weekStartISO);
        const effectiveWeekStart = Number.isNaN(parsedWeekStart.getTime()) ? getDefaultWeekStart() : parsedWeekStart;
        const currentWeekStart = getDefaultWeekStart();
        effectiveWeekStart.setHours(0, 0, 0, 0);
        const nextCalendarDays = payload.calendarDays.length
          ? payload.calendarDays
          : buildDefaultCalendarDays(effectiveWeekStart);
        const normalizedWeekStartISO = nextCalendarDays[0]?.date ?? payload.weekStartISO;
        const normalizedWeekStart = parseISODateJST(normalizedWeekStartISO) ?? new Date(normalizedWeekStartISO);
        if (!Number.isNaN(normalizedWeekStart.getTime())) {
          normalizedWeekStart.setHours(0, 0, 0, 0);
          setPlanWeekStart(normalizedWeekStart);
          setViewWeekStart(currentWeekStart);
        }
        setPlanDensity(payload.density);
        setViewDensity(payload.density);
        setPlanCalendarDays(nextCalendarDays);
        const loadedItems = payload.items.length ? payload.items : SAMPLE_ITEMS;
        const loadedMaterials = payload.materials.length ? payload.materials : SAMPLE_MATERIALS;
        const calendarSlots = buildCalendarSlots(nextCalendarDays, payload.density);
        setMaterialsMaster(mergeMaterialsFromItems(loadedItems, loadedMaterials));
        setItems(loadedItems);
        const mappedBlocks = payload.blocks.map((block) => {
          const startAtIndex = block.startAt
            ? slotIndexFromDateTime(
                block.startAt,
                nextCalendarDays,
                calendarSlots.rawHoursByDay,
                calendarSlots.slotsPerDay
              )
            : null;
          const endAtIndex = block.endAt
            ? slotIndexFromDateTime(
                block.endAt,
                nextCalendarDays,
                calendarSlots.rawHoursByDay,
                calendarSlots.slotsPerDay,
                true
              )
            : null;
          const start = startAtIndex ?? block.start ?? 0;
          const len =
            startAtIndex !== null && endAtIndex !== null
              ? Math.max(1, endAtIndex - startAtIndex)
              : Math.max(1, block.len ?? 1);
          return {
            ...block,
            start,
            len,
          };
        });
        setBlocks(mappedBlocks.length ? mappedBlocks : DEFAULT_BLOCKS());
      } catch {
        // 読み込み失敗時は既定値を維持
      } finally {
        if (!cancelled) setIsPlanLoaded(true);
      }
    };
    void loadPlan();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    const loadImportedData = async () => {
      try {
        const dailyResponse = await fetch("/api/daily-stocks");
        if (!dailyResponse.ok) return;
        const dailyPayload = (await dailyResponse.json()) as Partial<DailyStocksResponse>;
        if (cancelled) return;
        setDailyStocks(
          Array.isArray(dailyPayload.entries)
            ? dailyPayload.entries.map((entry) => ({
                ...entry,
                shipped: Number.isFinite(entry.shipped) ? entry.shipped : 0,
              }))
            : []
        );
        setDailyStockUpdatedAt(typeof dailyPayload.updatedAtISO === "string" ? dailyPayload.updatedAtISO : null);
      } catch {
        // 読み込み失敗時は既定値を維持
      }
    };
    void loadImportedData();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    const loadImportHeaders = async () => {
      try {
        const response = await fetch("/api/import-headers");
        if (!response.ok) return;
        const payload = (await response.json()) as Partial<ImportHeaderOverrides>;
        if (cancelled) return;
        const normalized = normalizeImportHeaderOverrides(payload);
        setDailyStockHeaderOverrides(normalized.dailyStock);
      } catch {
        // 読み込み失敗時は既定値を維持
      }
    };
    void loadImportHeaders();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  useEffect(() => {
    if (!isPlanLoaded || !canEditBlocks) return;
    const controller = new AbortController();
    const savePlan = async () => {
      try {
        const blocksWithDates = blocks.map((block) => {
          const startAt = slotToDateTime(
            block.start,
            planCalendarDays,
            planCalendar.rawHoursByDay,
            planCalendar.slotsPerDay
          );
          const endAt = slotBoundaryToDateTime(
            block.start + block.len,
            planCalendarDays,
            planCalendar.rawHoursByDay,
            planCalendar.slotsPerDay
          );
          return {
            ...block,
            startAt: startAt?.toISOString(),
            endAt: endAt?.toISOString(),
          };
        });
        await fetch("/api/plan", {
          method: "POST",
          headers: withCsrfHeader({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            version: 1,
            weekStartISO: planCalendarDays[0]?.date ?? toISODate(planWeekStart),
            density: planDensity,
            calendarDays: planCalendarDays,
            materials: materialsMaster,
            items,
            blocks: blocksWithDates,
          } satisfies PlanPayload),
          signal: controller.signal,
        });
      } catch {
        // 保存失敗時は再度の変更で再送される
      }
    };
    void savePlan();
    return () => {
      controller.abort();
    };
  }, [
    blocks,
    canEditBlocks,
    isPlanLoaded,
    items,
    materialsMaster,
    planCalendar,
    planCalendarDays,
    planDensity,
    planWeekStart,
  ]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages, chatBusy]);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    const loadChatHistory = async () => {
      try {
        const response = await fetch("/api/chat");
        if (!response.ok) return;
        const data = (await response.json()) as { messages?: ChatMessage[] };
        if (!cancelled && Array.isArray(data.messages)) {
          setChatMessages(data.messages);
        }
      } catch {
        // 読み込み失敗時は未読み込みのままにする
      }
    };
    void loadChatHistory();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    let cancelled = false;
    const loadConstraints = async () => {
      try {
        const response = await fetch("/api/constraints");
        if (!response.ok || response.status === 204) return;
        const data = (await response.json()) as { text?: string };
        if (!cancelled && typeof data?.text === "string") {
          setConstraintsText(data.text);
        }
      } catch {
        // 読み込み失敗時は未設定のままにする
      }
    };
    void loadConstraints();
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const appendChatHistory = async (messages: ChatMessage[]) => {
    if (!canUseChat) return;
    if (!messages.length) return;
    try {
      await fetch("/api/chat", {
        method: "POST",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({ messages }),
      });
    } catch {
      // 保存失敗時は次回の更新で再試行
    }
  };

  const buildPlanContext = (
    snapshot: PlanSnapshot,
    rangeStartISO: string,
    rangeEndISO: string,
    executedAtISO: string
  ) => {
    const horizonEndIndex = snapshot.calendarDays.findIndex((day) => day.date > rangeEndISO);
    const horizonCalendarDays =
      horizonEndIndex === -1 ? snapshot.calendarDays : snapshot.calendarDays.slice(0, horizonEndIndex);
    const horizonWeekDates = horizonCalendarDays.map((day) => day.date);
    const horizonSlotCount = horizonCalendarDays.length * snapshot.calendarSlots.slotsPerDay;
    const horizonSlotIndexToLabel = snapshot.slotIndexToLabel.slice(0, horizonSlotCount);
    const blockSummaries = blocks.map((b) => ({
      id: b.id,
      itemId: (itemMap.get(b.itemId)?.publicId ?? "").trim() || b.itemId,
      startSlot: b.start,
      startLabel: slotLabelFromCalendar({
        density: planDensity,
        calendarDays: snapshot.calendarDays,
        hoursByDay: snapshot.calendarSlots.hoursByDay,
        slotIndex: b.start,
      }),
      len: b.len,
      amount: b.amount,
      memo: b.memo,
      approved: b.approved,
      startAt: slotToDateTime(
        b.start,
        snapshot.calendarDays,
        snapshot.calendarSlots.rawHoursByDay,
        snapshot.calendarSlots.slotsPerDay
      )?.toISOString(),
      endAt: slotBoundaryToDateTime(
        b.start + b.len,
        snapshot.calendarDays,
        snapshot.calendarSlots.rawHoursByDay,
        snapshot.calendarSlots.slotsPerDay
      )?.toISOString(),
    }));
    const filteredBlocks = blockSummaries.filter((block) => {
      if (!block.startAt) return false;
      const blockDate = block.startAt.slice(0, 10);
      return blockDate >= rangeStartISO && blockDate <= rangeEndISO;
    });
    const isDateInRange = (date: string) => date >= rangeStartISO && date <= rangeEndISO;
    const filteredDailyStocks = dailyStocks.filter((entry) => isDateInRange(entry.date));
    const eodStocks = items.map((item) => ({
      itemId: (item.publicId ?? "").trim() || item.id,
      dates: horizonWeekDates,
      stocks: horizonWeekDates.map((_, idx) => eodStockByItem[item.id]?.[idx] ?? 0),
    }));

    return JSON.stringify(
      {
        executedAtISO,
        rangeStartISO,
        rangeEndISO,
        weekStartISO: horizonWeekDates[0] ?? snapshot.calendarDays[0]?.date ?? planWeekDates[0],
        density: planDensity,
        slotsPerDay: snapshot.calendarSlots.slotsPerDay,
        slotCount: horizonSlotCount,
        slotIndexToLabel: horizonSlotIndexToLabel,
        calendarDays: horizonCalendarDays,
        materials: materialsMaster,
        items: items.map((item) => ({
          itemId: (item.publicId ?? "").trim() || item.id,
          unit: item.unit,
          planningPolicy: item.planningPolicy,
          safetyStock: item.safetyStock,
          shelfLifeDays: item.shelfLifeDays,
          productionEfficiency: item.productionEfficiency,
          notes: item.notes,
          recipe: item.recipe.map((line) => ({
            ...line,
            materialName: materialMap.get(line.materialId)?.name ?? "未登録原料",
          })),
        })),
        dailyStocks: filteredDailyStocks.map((entry) => ({
          date: entry.date,
          itemCode: entry.itemCode,
          stock: entry.stock,
          shipped: entry.shipped,
        })),
        eodStocks,
        blocks: filteredBlocks,
      },
      null,
      2
    );
  };

  type SlotResolveContext = {
    slotCount: number;
    slotIndexToLabel: string[];
    warnings: string[];
  };

  const resolveItemId = (action: ChatAction) => {
    if (!action.itemId) return null;
    const trimmed = action.itemId.trim();
    return itemKeyMap.get(trimmed) ?? null;
  };

  const resolveSlotIndex = (action: ChatAction, context?: SlotResolveContext) => {
    const slotCount = context?.slotCount ?? planSlotCount;
    const slotIndexToLabel = context?.slotIndexToLabel ?? planSlotIndexToLabel;
    if (Number.isFinite(action.startSlot)) {
      const rawSlot = Number(action.startSlot);
      if (rawSlot < 0 || rawSlot >= slotCount) {
        context?.warnings.push(`startSlot ${rawSlot} は 0〜${slotCount - 1} の範囲外です。`);
      } else {
        return rawSlot;
      }
    }
    if (action.startLabel) {
      const idx = slotIndexToLabel.findIndex((label) => label === action.startLabel);
      if (idx >= 0) return idx;
    }
    return null;
  };

  const resolveBlockId = (action: ChatAction, currentBlocks: Block[], context?: SlotResolveContext) => {
    if (action.blockId && currentBlocks.some((b) => b.id === action.blockId)) return action.blockId;
    const itemId = resolveItemId(action);
    const start = resolveSlotIndex(action, context);
    if (!itemId || start === null) return null;
    const found = currentBlocks.find((b) => b.itemId === itemId && b.start === start);
    return found?.id ?? null;
  };

  const applyChatActions = (
    actions: ChatAction[],
    contextOverrides?: { slotCount?: number; slotIndexToLabel?: string[] }
  ) => {
    const warnings: string[] = [];
    if (!actions.length) return warnings;
    const operatorName = resolveOperatorName();
    const slotCount = contextOverrides?.slotCount ?? planSlotCount;
    const slotIndexToLabel = contextOverrides?.slotIndexToLabel ?? planSlotIndexToLabel;
    const context: SlotResolveContext = { slotCount, slotIndexToLabel, warnings };
    setBlocks((prev) => {
      let next = [...prev];
      actions.forEach((action) => {
        if (action.type === "create_block") {
          const itemId = resolveItemId(action);
          const start = resolveSlotIndex(action, context);
          if (!itemId || start === null) return;
          const len = clamp(action.len ?? 1, 1, slotCount - start);
          const candidate: Block = {
            id: uid("b"),
            itemId,
            start,
            len,
            amount: Math.max(0, action.amount ?? 0),
            memo: action.memo ?? "",
            approved: false,
            createdBy: operatorName,
            updatedBy: operatorName,
          };
          next = [...next, resolveOverlap(candidate, next)];
        }

        if (action.type === "update_block") {
          const targetId = resolveBlockId(action, next, context);
          if (!targetId) return;
          const target = next.find((b) => b.id === targetId);
          if (!target || target.approved) return;
          next = next.map((b) => {
            if (b.id !== targetId) return b;
            const itemId = resolveItemId(action) ?? b.itemId;
            const start = resolveSlotIndex(action, context) ?? b.start;
            const len = clamp(action.len ?? b.len, 1, slotCount - start);
            return resolveOverlap(
              {
                ...b,
                itemId,
                start,
                len,
                amount: action.amount ?? b.amount,
                memo: action.memo ?? b.memo,
                approved: false,
                createdBy: b.createdBy ?? operatorName,
                updatedBy: operatorName,
              },
              next
            );
          });
        }

        if (action.type === "delete_block") {
          const targetId = resolveBlockId(action, next, context);
          if (!targetId) return;
          const target = next.find((b) => b.id === targetId);
          if (!target || target.approved) return;
          next = next.filter((b) => b.id !== targetId);
        }
      });
      return next;
    });
    return warnings;
  };

  const sendChatMessage = async () => {
    if (!canUseChat) {
      setChatError(readOnlyMessage);
      return;
    }
    const trimmed = chatInput.trim();
    if (!trimmed || chatBusy) return;
    const userMessageId = uid("chat");
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: trimmed,
      createdAt: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput("");
    setChatBusy(true);
    setChatError(null);

    const executedAt = new Date();
    const horizonDays = Math.max(1, Math.floor(geminiHorizonDays));
    const horizonStartISO = toISODate(addDays(executedAt, -7));
    const horizonEndISO = toISODate(addDays(executedAt, horizonDays));
    const extendedCalendarDays = extendCalendarDaysTo(planCalendarDays, horizonEndISO);
    if (extendedCalendarDays.length !== planCalendarDays.length) {
      setPlanCalendarDays(extendedCalendarDays);
    }
    const planSnapshot = buildPlanSnapshot(extendedCalendarDays, planDensity);

    const systemInstruction = [
      "あなたは製造計画のアシスタントです。",
      "返答は必ずJSONのみで、説明文やコードブロックは含めません。",
      "次のスキーマに従ってください。",
      "{",
      '  "summary": "ユーザーに伝える短い要約",',
      '  "actions": [',
      "    {",
      '      "type": "create_block | update_block | delete_block",',
      '      "blockId": "既存ブロックコード（更新/削除時に推奨）",',
      '      "itemId": "品目コード（マスタで設定したコード）",',
      '      "startSlot": "開始スロット番号（0始まり）",',
      '      "startLabel": "開始ラベル（startSlotが不明な場合）",',
      '      "len": "スロット長",',
      '      "amount": "生産数量",',
      '      "memo": "メモ"',
      "    }",
      "  ]",
      "}",
      "startSlotかstartLabelのどちらかは必ず指定してください。",
      "既存ブロックの更新/削除ではblockIdを優先してください。",
      "承認済みのブロックは編集・削除できません。",
      "ユーザーが「空いてるところ」「空き枠」「この日までに」などの曖昧な指示を出した場合は、blocksの重複を避けつつ、条件に合う最も早いスロットを選んでstartSlotを必ず指定してください。",
      "ブロックを作成または移動する場合は、なぜそのスロットを選んだかの根拠をmemoに必ず記載してください。",
      "計画データの対象期間はrangeStartISO〜rangeEndISOです。範囲外の指示は避けてください。",
    ].join("\n");

    const planContext = buildPlanContext(planSnapshot, horizonStartISO, horizonEndISO, executedAt.toISOString());
    const constraintsNote = constraintsText.trim() ? `\n\nユーザー制約条件:\n${constraintsText.trim()}` : "";
    const messageWithContext = `現在の計画データ(JSON):\n${planContext}\n\nユーザー入力:\n${trimmed}${constraintsNote}`;
    const chatHistoryCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentChatMessages = chatMessages.filter((message) => {
      if (!message.createdAt) return false;
      const timestamp = Date.parse(message.createdAt);
      if (Number.isNaN(timestamp)) return false;
      return timestamp >= chatHistoryCutoff;
    });

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: geminiModel,
          systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
          contents: [
            ...recentChatMessages.map((msg) => ({
              role: msg.role === "assistant" ? "model" : "user",
              parts: [{ text: msg.content }],
            })),
            { role: "user", parts: [{ text: messageWithContext }] },
          ],
        }),
      });

      if (response.status === 409) {
        const errorPayload = (await response.json().catch(() => null)) as { message?: string } | null;
        const message =
          errorPayload?.message ??
          "現在別の指示を処理しています。処理結果を確認後に再度実行してください。";
        setChatError(message);
        const assistantMessage: ChatMessage = {
          id: uid("chat"),
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
        void appendChatHistory([userMessage, assistantMessage]);
        return;
      }

      if (response.status === 401) {
        const errorBody = await response.text();
        console.error("Gemini API認証エラー:", {
          status: response.status,
          body: errorBody,
        });
        const message = "サーバー側にGemini APIキーが設定されていません。data/.envにGEMINI_API_KEYを設定してください。";
        setChatError(message);
        const assistantMessage: ChatMessage = {
          id: uid("chat"),
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
        void appendChatHistory([userMessage, assistantMessage]);
        return;
      }

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Gemini APIエラー:", {
          status: response.status,
          body: errorBody,
        });
        throw new Error(`Gemini APIエラー: ${response.status}`);
      }
      const data = await response.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const jsonText = extractJsonPayload(rawText) ?? rawText;
      let parsed: ChatResponsePayload | null = null;
      try {
        parsed = JSON.parse(jsonText);
      } catch (error) {
        parsed = null;
      }

      let actionWarnings: string[] = [];
      if (parsed?.actions) {
        actionWarnings = applyChatActions(parsed.actions, {
          slotCount: planSnapshot.slotCount,
          slotIndexToLabel: planSnapshot.slotIndexToLabel,
        });
        if (actionWarnings.length) {
          setChatError(`警告:\n${actionWarnings.join("\n")}`);
        }
      }

      const assistantContent =
        parsed?.summary ??
        (parsed?.actions?.length ? `更新アクションを${parsed.actions.length}件適用しました。` : rawText);

      const assistantMessage: ChatMessage = {
        id: uid("chat"),
        role: "assistant",
        content: assistantContent.trim() || "更新しました。",
        createdAt: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
      void appendChatHistory([userMessage, assistantMessage]);
    } catch (error) {
      console.error("Gemini API呼び出しエラー:", error);
      const message = error instanceof Error ? error.message : "Gemini API呼び出しに失敗しました。";
      setChatError(message);
      const assistantMessage: ChatMessage = {
        id: uid("chat"),
        role: "assistant",
        content: "API呼び出しでエラーが発生しました。",
        createdAt: new Date().toISOString(),
      };
      setChatMessages((prev) => [...prev, assistantMessage]);
      void appendChatHistory([userMessage, assistantMessage]);
    } finally {
      setChatBusy(false);
    }
  };

  const saveConstraints = async () => {
    if (!canUseChat) {
      setConstraintsError(readOnlyMessage);
      return;
    }
    if (constraintsBusy) return;
    setConstraintsBusy(true);
    setConstraintsError(null);
    try {
      const nextHorizonDays = Math.max(1, Math.floor(safeNumber(geminiHorizonDaysDraft) || 30));
      const response = await fetch("/api/constraints", {
        method: "POST",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify({ text: constraintsDraft }),
      });
      if (!response.ok) {
        throw new Error("保存に失敗しました。");
      }
      setConstraintsText(constraintsDraft);
      setGeminiHorizonDays(nextHorizonDays);
      setGeminiHorizonDaysDraft(String(nextHorizonDays));
      setConstraintsOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存に失敗しました。";
      setConstraintsError(message);
    } finally {
      setConstraintsBusy(false);
    }
  };

  const openPlanEdit = (block: Block, options?: { isNew?: boolean }) => {
    setActiveBlockId(block.id);
    setFormAmount(String(block.amount ?? 0));
    setFormMemo(block.memo ?? "");
    setFormItemId(block.itemId);
    setFormApproved(block.approved);
    setPendingBlockId(options?.isNew ? block.id : null);
    setOpenPlan(true);
  };

  const onPlanSave = () => {
    if (!canEditActiveBlock) return;
    if (!activeBlockId) return;
    const amount = Math.max(0, safeNumber(formAmount));
    const operatorName = resolveOperatorName();
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === activeBlockId
          ? {
              ...b,
              itemId: formItemId || b.itemId,
              amount,
              memo: formMemo,
              approved: isAdmin ? formApproved : b.approved,
              createdBy: b.createdBy ?? operatorName,
              updatedBy: operatorName,
            }
          : b
      )
    );
    setPendingBlockId(null);
    setOpenPlan(false);
  };

  const handlePlanOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setOpenPlan(true);
      return;
    }
    if (pendingBlockId) {
      setBlocks((prev) => prev.filter((b) => b.id !== pendingBlockId));
      setPendingBlockId(null);
      setActiveBlockId(null);
    }
    setOpenPlan(false);
  };

  const createBlockAt = (dayIndex: number, slot: number) => {
    if (!canEditBlocks) return;
    if (!isPlanWeekView) return;
    const workingSlot = clampToWorkingSlot(dayIndex, slot, viewCalendar.rawHoursByDay);
    if (workingSlot === null) return;
    const absoluteSlot = (viewStartOffsetDays + dayIndex) * slotsPerDay + workingSlot;
    const planSlot = clamp(convertSlotIndex(absoluteSlot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const fallbackItemId = items[0]?.id ?? "";
    const operatorName = resolveOperatorName();
    const b: Block = {
      id: uid("b"),
      itemId: fallbackItemId,
      start: planSlot,
      len: 1,
      amount: 0,
      memo: "",
      approved: false,
      createdBy: operatorName,
      updatedBy: operatorName,
    };
    setBlocks((prev) => [...prev, b]);
    openPlanEdit(b, { isNew: true });
  };

  const resolveOverlap = (candidate: Block, allBlocks: Block[]): Block => {
    const sameLane = allBlocks.filter((x) => x.id !== candidate.id).sort((a, b) => a.start - b.start);

    let start = candidate.start;
    let len = candidate.len;

    for (const b of sameLane) {
      const a1 = start;
      const a2 = start + len;
      const b1 = b.start;
      const b2 = b.start + b.len;
      const overlap = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
      if (overlap > 0) start = clamp(b2, 0, planSlotCount - 1);
    }

    start = clamp(start, 0, planSlotCount - 1);
    len = clamp(len, 1, planSlotCount - start);

    return { ...candidate, start, len };
  };

  const beginPointer = (p: { kind: DragKind; blockId: string; dayIndex: number; clientX: number }) => {
    if (!canEditBlocks) return;
    if (!isPlanWeekView) return;
    const laneEl = laneRefs.current[String(p.dayIndex)];
    if (!laneEl) return;
    const rect = laneEl.getBoundingClientRect();
    const block = blocks.find((b) => b.id === p.blockId);
    if (!block || block.approved) return;
    const slot = xToSlot(p.clientX, { left: rect.left, width: rect.width }, slotsPerDay);
    const workingSlot = clampToWorkingSlot(p.dayIndex, slot, viewCalendar.rawHoursByDay);
    if (workingSlot === null) return;
    const absoluteSlot = (viewStartOffsetDays + p.dayIndex) * slotsPerDay + workingSlot;
    const planSlot = clamp(convertSlotIndex(absoluteSlot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const pointerOffset = clamp(planSlot - block.start, 0, Math.max(0, block.len - 1));

    suppressClickRef.current = true;

    dragStateRef.current = {
      kind: p.kind,
      blockId: p.blockId,
      originStart: block.start,
      originLen: block.len,
      pointerOffset,
      laneRect: { left: rect.left, width: rect.width },
      dayIndex: p.dayIndex,
      moved: false,
    };
  };

  const resolveLaneAtPointer = (clientY: number) => {
    for (let i = 0; i < weekDates.length; i += 1) {
      const laneEl = laneRefs.current[String(i)];
      if (!laneEl) continue;
      const rect = laneEl.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return { dayIndex: i, rect };
      }
    }
    return null;
  };

  const onPointerMove = (e: PointerEvent) => {
    const s = dragStateRef.current;
    if (!s) return;

    let activeDayIndex = s.dayIndex;
    let laneRect = s.laneRect;
    if (s.kind === "move") {
      const lane = resolveLaneAtPointer(e.clientY);
      if (lane) {
        activeDayIndex = lane.dayIndex;
        laneRect = lane.rect;
        s.dayIndex = lane.dayIndex;
        s.laneRect = lane.rect;
      }
    }

    const slot = xToSlot(e.clientX, laneRect, slotsPerDay);
    const workingSlot = clampToWorkingSlot(activeDayIndex, slot, viewCalendar.rawHoursByDay);
    if (workingSlot === null) return;
    const absoluteSlot = (viewStartOffsetDays + activeDayIndex) * slotsPerDay + workingSlot;
    const planSlot = clamp(convertSlotIndex(absoluteSlot, viewDensity, planDensity, "floor"), 0, planSlotCount - 1);
    const planSlotEnd = clamp(convertSlotIndex(absoluteSlot + 1, viewDensity, planDensity, "ceil"), 1, planSlotCount);
    const planDayIndex = viewStartOffsetDays + activeDayIndex;
    const daySlots = planCalendar.rawHoursByDay[planDayIndex]?.length ?? 0;
    if (!daySlots) return;
    const dayStart = planDayIndex * planSlotsPerDay;
    const dayEnd = dayStart + daySlots;
    s.moved = true;

    setBlocks((prev) => {
      const next = prev.map((b) => {
        if (b.id !== s.blockId) return b;

        if (s.kind === "move") {
          const maxStart = Math.max(dayStart, dayEnd - s.originLen);
          const start = clamp(planSlot - s.pointerOffset, dayStart, maxStart);
          const len = clamp(s.originLen, 1, planSlotCount - start);
          return resolveOverlap({ ...b, start, len }, prev);
        }

        if (s.kind === "resizeL") {
          const end = s.originStart + s.originLen;
          const newStart = clamp(planSlot, dayStart, end - 1);
          const newLen = clamp(end - newStart, 1, planSlotCount - newStart);
          return resolveOverlap({ ...b, start: newStart, len: newLen }, prev);
        }

        const newEnd = clamp(planSlotEnd, b.start + 1, dayEnd);
        const newLen = clamp(newEnd - b.start, 1, planSlotCount - b.start);
        return resolveOverlap({ ...b, len: newLen }, prev);
      });
      return next;
    });
  };

  const endPointer = () => {
    const currentDrag = dragStateRef.current;
    if (currentDrag?.moved) {
      const operatorName = resolveOperatorName();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === currentDrag.blockId
            ? { ...b, createdBy: b.createdBy ?? operatorName, updatedBy: operatorName }
            : b
        )
      );
    }
    dragStateRef.current = null;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 120);
  };

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPointer);
    window.addEventListener("pointercancel", endPointer);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPointer);
      window.removeEventListener("pointercancel", endPointer);
    };
  }, [
    planCalendar.rawHoursByDay,
    planDensity,
    planSlotCount,
    planSlotsPerDay,
    slotsPerDay,
    viewCalendar,
    viewDensity,
    viewStartOffsetDays,
  ]);

  const openRecipeEdit = (itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    setActiveRecipeItemId(itemId);
    setRecipeDraft(it.recipe.map((r) => ({ ...r })));
    setOpenRecipe(true);
  };

  const onRecipeSave = () => {
    if (!activeRecipeItemId) return;
    const validMaterialIds = new Set(materialsMaster.map((m) => m.id));
    setItems((prev) =>
      prev.map((it) =>
        it.id === activeRecipeItemId
          ? {
              ...it,
              recipe: recipeDraft
                .map((r) => ({
                  materialId: (r.materialId ?? "").trim(),
                  perUnit: Number.isFinite(Number(r.perUnit)) ? Number(r.perUnit) : 0,
                  unit: asRecipeUnit(r.unit),
                }))
                .filter((r) => r.materialId.length > 0 && validMaterialIds.has(r.materialId)),
            }
          : it
      )
    );
    setOpenRecipe(false);
  };

  const openCreateItemModal = () => {
    setItemDialogState({
      open: true,
      mode: "create",
      editingItemId: null,
    });
  };

  const computeSafetyStockFromDaily = (item: Item) => {
    const lookbackDays = Math.max(0, Math.floor(item.safetyStockLookbackDays));
    if (lookbackDays <= 0) return null;
    const coefficient = Math.max(0, item.safetyStockCoefficient);
    const dailyForItem = dailyStocks.filter((entry) => entry.itemId === item.id);
    if (!dailyForItem.length) return null;
    const baseDateISO = toISODate(new Date());
    const baseDateValue = parseISODateJST(baseDateISO);
    if (!baseDateValue) return null;
    const startISO = toISODate(addDays(baseDateValue, -(lookbackDays - 1)));
    const shippedTotal = dailyForItem.reduce((sum, entry) => {
      if (entry.date < startISO || entry.date > baseDateISO) return sum;
      return sum + (Number.isFinite(entry.shipped) ? entry.shipped : 0);
    }, 0);
    return {
      safetyStock: Math.max(0, shippedTotal * coefficient),
      rangeStartISO: startISO,
      rangeEndISO: baseDateISO,
    };
  };

  const applySafetyStockForItem = (itemId: string) => {
    if (!canManageMaster) return;
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    const result = computeSafetyStockFromDaily(item);
    if (!result) {
      window.alert("出荷数データが不足しているため、安全在庫を算出できませんでした。");
      return;
    }
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, safetyStock: result.safetyStock } : it))
    );
  };

  const applySafetyStockForTargets = () => {
    if (!canManageMaster) return;
    const targets = items.filter((item) => item.safetyStockAutoEnabled);
    if (!targets.length) {
      window.alert("自動計算の対象となる品目がありません。");
      return;
    }
    let updated = 0;
    let skipped = 0;
    const nextById = new Map<string, number>();
    targets.forEach((item) => {
      const result = computeSafetyStockFromDaily(item);
      if (!result) {
        skipped += 1;
        return;
      }
      nextById.set(item.id, result.safetyStock);
      updated += 1;
    });
    if (updated === 0) {
      window.alert("出荷数データが不足しているため、一括計算できませんでした。");
      return;
    }
    setItems((prev) =>
      prev.map((it) => (nextById.has(it.id) ? { ...it, safetyStock: nextById.get(it.id) ?? it.safetyStock } : it))
    );
    if (skipped > 0) {
      window.alert(`安全在庫を${updated}件更新しました。出荷数不足で${skipped}件はスキップしました。`);
    }
  };

  const openEditItemModal = (item: Item) => {
    setItemDialogState({
      open: true,
      mode: "edit",
      editingItemId: item.id,
    });
  };

  const handleItemDialogOpenChange = (open: boolean) => {
    setItemDialogState((prev) => ({
      ...prev,
      open,
      editingItemId: open ? prev.editingItemId : null,
    }));
  };

  const handleMaterialDialogOpenChange = (open: boolean) => {
    setMaterialDialogState((prev) => ({
      open,
      editingMaterialId: open ? prev.editingMaterialId : null,
    }));
  };

  const eodStockByItem = useMemo(() => {
    const blocksForEod = isPlanWeekView ? blocks : [];
    const out: Record<string, number[]> = {};
    const weekDatesForEod = weekDates;
    const todayISO = toISODate(new Date());

    for (const it of items) {
      const addByDay = new Array(7).fill(0);
      for (const b of blocksForEod) {
        if (b.itemId !== it.id) continue;
        const dayIndex = endDayIndex(b, planSlotsPerDay) - viewStartOffsetDays;
        if (dayIndex < 0 || dayIndex >= 7) continue;
        const blockDate = weekDatesForEod[dayIndex];
        if (!blockDate || blockDate < todayISO) continue;
        addByDay[dayIndex] += Number.isFinite(b.amount) ? b.amount : 0;
      }
      const eod = new Array(7).fill(0);
      const itemStockMap = dailyStockMap.get(it.id);
      const stockEntries = itemStockMap
        ? Array.from(itemStockMap.entries()).sort(([a], [b]) => a.localeCompare(b))
        : [];
      let stockIndex = 0;
      let baseStockByDate = 0;
      let plannedCumulative = 0;
      for (let d = 0; d < 7; d += 1) {
        const date = weekDatesForEod[d];
        if (!date) continue;
        while (stockIndex < stockEntries.length && stockEntries[stockIndex][0] <= date) {
          baseStockByDate = stockEntries[stockIndex][1];
          stockIndex += 1;
        }
        if (date < todayISO) {
          eod[d] = itemStockMap?.get(date) ?? 0;
          continue;
        }
        plannedCumulative += addByDay[d];
        eod[d] = baseStockByDate + plannedCumulative;
      }
      out[it.id] = eod;
    }

    return out;
  }, [blocks, dailyStockMap, isPlanWeekView, items, planSlotsPerDay, viewStartOffsetDays, weekDates]);

  const eodSummaryByDay = useMemo(() => {
    const blocksForEod = isPlanWeekView ? blocks : [];
    const itemsByDay: Record<number, Set<string>> = {};

    for (const b of blocksForEod) {
      const d = endDayIndex(b, planSlotsPerDay) - viewStartOffsetDays;
      if (d < 0 || d >= 7) continue;
      if (!itemsByDay[d]) itemsByDay[d] = new Set();
      itemsByDay[d].add(b.itemId);
    }

    return weekDates.map((_, dayIdx) => {
      const ids = Array.from(itemsByDay[dayIdx] ?? []);
      return ids.map((id) => {
        const item = itemMap.get(id);
        return {
          itemId: id,
          name: item?.name ?? id,
          unit: item?.unit ?? "",
          stock: eodStockByItem[id]?.[dayIdx] ?? 0,
        };
      });
    });
  }, [blocks, eodStockByItem, isPlanWeekView, itemMap, planSlotsPerDay, viewStartOffsetDays, weekDates]);

  // JSONエクスポート
  const exportPlanAsJson = () => {
    if (!canExportJson) return;
    const payload = buildExportPayload({
      weekStart: planWeekStart,
      timezone,
      density: planDensity,
      calendarDays: planCalendarDays,
      hoursByDay: planCalendar.hoursByDay,
      slotsPerDay: planSlotsPerDay,
      slotCount: planSlotCount,
      materials: materialsMaster,
      items,
      blocks,
      dailyStocks,
      eodStocks: items.map((item) => ({
        itemId: item.id,
        itemCode: (item.publicId ?? "").trim() || item.id,
        dates: planWeekDates,
        stocks: eodStockByItem[item.id] ?? [],
      })),
    });

    const json = JSON.stringify(payload, null, 2);
    const filename = `manufacturing_plan_${payload.meta.weekStartISO}_${planDensity}.json`;
    downloadTextFile(filename, json, "application/json");
  };

  // 表示上の列幅
  const colW = viewDensity === "day" ? 120 : 72;

  // 目盛線（時間グリッド）
  const slotGridBg = `repeating-linear-gradient(to right, transparent 0, transparent ${
    colW - 1
  }px, rgba(148, 163, 184, 0.4) ${colW - 1}px, rgba(148, 163, 184, 0.4) ${colW}px)`;

  const materialDialogMode: "create" | "edit" = materialDialogState.editingMaterialId ? "edit" : "create";
  const handleItemDialogSave = (payload: ItemDialogCommitPayload) => {
    if (payload.action === "delete") {
      const itemId = payload.itemId;
      setItems((prev) => prev.filter((it) => it.id !== itemId));
      setBlocks((prev) => prev.filter((b) => b.itemId !== itemId));
      if (activeBlockId) {
        const hasActive = blocks.some((b) => b.id === activeBlockId && b.itemId === itemId);
        if (hasActive) {
          setActiveBlockId(null);
          setOpenPlan(false);
        }
      }
      if (activeRecipeItemId === itemId) {
        setActiveRecipeItemId(null);
        setOpenRecipe(false);
      }
      return true;
    }

    const values = payload.values;
    const safetyStock = Math.max(0, safeNumber(values.safetyStock));
    const safetyStockLookbackDays = Math.max(0, safeNumber(values.safetyStockLookbackDays));
    const safetyStockCoefficient = Math.max(0, safeNumber(values.safetyStockCoefficient));
    const shelfLifeDays = Math.max(0, safeNumber(values.shelfLifeDays));
    const productionEfficiency = Math.max(0, safeNumber(values.productionEfficiency));
    const packagingEfficiency = Math.max(0, safeNumber(values.packagingEfficiency));
    const notes = values.notes.trim();

    if (payload.action === "create") {
      const newItem: Item = {
        id: uid("item"),
        publicId: values.publicId || undefined,
        name: values.name,
        unit: values.unit,
        planningPolicy: values.planningPolicy,
        safetyStock,
        safetyStockAutoEnabled: values.safetyStockAutoEnabled,
        safetyStockLookbackDays,
        safetyStockCoefficient,
        shelfLifeDays,
        productionEfficiency,
        packagingEfficiency,
        notes,
        recipe: [],
      };
      setItems((prev) => [...prev, newItem]);
      return true;
    }

    setItems((prev) =>
      prev.map((it) =>
        it.id === payload.itemId
          ? {
              ...it,
              publicId: values.publicId || undefined,
              name: values.name,
              unit: values.unit,
              planningPolicy: values.planningPolicy,
              safetyStock,
              safetyStockAutoEnabled: values.safetyStockAutoEnabled,
              safetyStockLookbackDays,
              safetyStockCoefficient,
              shelfLifeDays,
              productionEfficiency,
              packagingEfficiency,
              notes,
            }
          : it
      )
    );
    return true;
  };

  const handleMaterialSave = (payload: {
    mode: "create" | "edit";
    materialId?: string;
    name: string;
    unit: RecipeUnit;
  }) => {
    if (payload.mode === "create") {
      const newMaterial: Material = {
        id: uid("mat"),
        name: payload.name,
        unit: payload.unit,
      };
      setMaterialsMaster((prev) => [...prev, newMaterial]);
      return true;
    }
    if (!payload.materialId) return false;
    setMaterialsMaster((prev) =>
      prev.map((material) =>
        material.id === payload.materialId
          ? {
              ...material,
              name: payload.name,
              unit: payload.unit,
            }
          : material
      )
    );
    return true;
  };

  const scheduleHeader = (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <div className="text-2xl font-semibold tracking-tight">製造計画</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={exportPlanAsJson} disabled={!canExportJson}>
          JSONエクスポート
        </Button>
        <Button variant="outline" onClick={() => shiftWeek(-7)}>
          前の週
        </Button>
        <Button variant="outline" onClick={() => shiftWeek(7)}>
          次の週
        </Button>

        <div className="w-44">
          <Select value={viewDensity} onValueChange={(v) => setViewDensity(v as Density)}>
            <SelectTrigger>
              <SelectValue placeholder="表示密度" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hour">1時間</SelectItem>
              <SelectItem value="2hour">2時間</SelectItem>
              <SelectItem value="day">日単位</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  const scheduleCard = (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="flex min-h-[56px] items-center pb-2">
        <CardTitle className="text-base font-medium">
          週表示：{weekDates[0] ? toMD(weekDates[0]) : ""} 〜{" "}
          {weekDates.length ? toMD(weekDates[weekDates.length - 1]) : ""}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
          <div
            className="min-w-[1100px] text-slate-900"
            style={{
              display: "grid",
              gridTemplateColumns: `220px repeat(${slotsPerDay}, ${colW}px) 220px`,
            }}
          >
            {/* ヘッダ（時間） */}
            <div className="sticky left-0 top-0 z-50 bg-white border-b border-r p-3 font-medium">日付</div>
            {slotHeaderLabels.map((label, idx) => (
              <div
                key={`hour-${label || "blank"}-${idx}`}
                className="sticky top-0 z-20 bg-white border-b border-r p-2 text-center text-xs text-muted-foreground"
              >
                {label || (viewDensity === "day" ? "日" : "")}
              </div>
            ))}
            <div className="sticky top-0 z-30 bg-white border-b p-3 text-center font-medium">在庫（EOD）</div>

            {/* 行（日付） */}
            {weekDates.map((date, dayIdx) => {
              const calendarDay = viewCalendarDays[dayIdx];
              const eodList = eodSummaryByDay[dayIdx] ?? [];
              const laneBlocks = (isPlanWeekView ? blocks : [])
                .map((b) => {
                  const rawViewStart = convertSlotIndex(b.start, planDensity, viewDensity, "floor");
                  const viewStart = rawViewStart - viewOffsetSlots;
                  const viewLen = convertSlotLength(b.len, planDensity, viewDensity, "ceil");
                  const viewDayIdx = Math.floor(viewStart / slotsPerDay);
                  if (viewDayIdx < 0 || viewDayIdx >= DAYS_IN_WEEK) return null;
                  const viewStartInDay = viewStart - viewDayIdx * slotsPerDay;
                  const maxLen = Math.max(1, slotsPerDay - viewStartInDay);
                  return {
                    block: b,
                    viewDayIdx,
                    viewStartInDay,
                    viewLen: clamp(viewLen, 1, maxLen),
                  };
                })
                .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
                .filter((entry) => entry.viewDayIdx === dayIdx)
                .sort((a, b) => a.viewStartInDay - b.viewStartInDay);

              const laneRows: number[] = [];
              const stackedLaneBlocks = laneBlocks.map((entry) => {
                let rowIndex = laneRows.findIndex((rowEnd) => entry.viewStartInDay >= rowEnd);
                if (rowIndex < 0) {
                  laneRows.push(entry.viewStartInDay + entry.viewLen);
                  rowIndex = laneRows.length - 1;
                } else {
                  laneRows[rowIndex] = entry.viewStartInDay + entry.viewLen;
                }

                return {
                  ...entry,
                  rowIndex,
                };
              });

              const laneTopPadding = 8;
              const laneBottomPadding = 12;
              const laneRowGap = 8;
              const blockHeight = 52;
              const laneRowCount = Math.max(1, laneRows.length);
              const laneHeight = laneTopPadding + laneBottomPadding + laneRowCount * blockHeight + (laneRowCount - 1) * laneRowGap;

              return (
                <React.Fragment key={date}>
                  <div className="sticky left-0 z-40 bg-white border-b border-r p-3">
                    <div className="text-sm font-semibold">{toMD(date)}</div>
                    <div className="text-xs text-muted-foreground">({toWeekday(date)})</div>
                    {calendarDay?.isHoliday ? (
                      <div className="mt-1 text-[10px] font-medium text-rose-500">休日</div>
                    ) : null}
                  </div>

                  <div
                    className="relative border-b overflow-hidden"
                    style={{ gridColumn: `span ${slotsPerDay}`, height: laneHeight }}
                    ref={(el) => {
                      laneRefs.current[String(dayIdx)] = el;
                    }}
                    onClick={(e) => {
                      if (!canEditBlocks) return;
                      if (suppressClickRef.current) return;
                      if (e.defaultPrevented) return;

                      const rect = e.currentTarget.getBoundingClientRect();
                      const slot = xToSlot(e.clientX, { left: rect.left, width: rect.width }, slotsPerDay);
                      createBlockAt(dayIdx, slot);
                    }}
                  >
                    <div className="absolute inset-0" style={{ backgroundImage: slotGridBg, opacity: 0.8 }} />

                    {stackedLaneBlocks.map(({ block, viewStartInDay, viewLen, rowIndex }) => {
                      const left = viewStartInDay * colW;
                      const width = viewLen * colW;
                      const top = laneTopPadding + rowIndex * (blockHeight + laneRowGap);
                      const isActive = block.id === activeBlockId;
                      const item = itemMap.get(block.itemId);
                      const toneClass = block.approved
                        ? isActive
                          ? " border-emerald-500 bg-emerald-200"
                          : " border-emerald-200 bg-emerald-100 hover:bg-emerald-200"
                        : isActive
                          ? " border-sky-400 bg-sky-200"
                          : " border-sky-200 bg-sky-100 hover:bg-sky-200";

                      const isApproved = block.approved;
                      return (
                        <motion.div
                          key={block.id}
                          className={"absolute h-[52px] rounded-xl border shadow-sm touch-none" + toneClass}
                          style={{ left, width, top }}
                          whileTap={{ scale: 0.99 }}
                          onClick={(ev) => {
                            if (suppressClickRef.current) return;
                            ev.preventDefault();
                            ev.stopPropagation();
                            openPlanEdit(block);
                          }}
                        >
                          {isApproved ? null : (
                            <div
                              className="absolute left-0 top-0 z-30 h-full w-2 cursor-ew-resize rounded-l-xl touch-none"
                              onPointerDown={(ev) => {
                                if (!canEditBlocks) return;
                                ev.preventDefault();
                                ev.stopPropagation();
                                beginPointer({ kind: "resizeL", blockId: block.id, dayIndex: dayIdx, clientX: ev.clientX });
                              }}
                              title="幅調整（左）"
                            />
                          )}

                          {isApproved ? null : (
                            <div
                              className="absolute right-0 top-0 z-30 h-full w-2 cursor-ew-resize rounded-r-xl touch-none"
                              onPointerDown={(ev) => {
                                if (!canEditBlocks) return;
                                ev.preventDefault();
                                ev.stopPropagation();
                                beginPointer({ kind: "resizeR", blockId: block.id, dayIndex: dayIdx, clientX: ev.clientX });
                              }}
                              title="幅調整（右）"
                            />
                          )}

                          <div
                            className={`absolute inset-0 z-10 select-none rounded-xl p-2 touch-none ${
                              isApproved ? "cursor-default" : "cursor-grab"
                            }`}
                            onPointerDown={(ev) => {
                              if (!canEditBlocks || isApproved) return;
                              const r = ev.currentTarget.getBoundingClientRect();
                              const x = ev.clientX - r.left;
                              if (x <= 8 || x >= r.width - 8) return;
                              ev.preventDefault();
                              ev.stopPropagation();
                              beginPointer({ kind: "move", blockId: block.id, dayIndex: dayIdx, clientX: ev.clientX });
                            }}
                          >
                            <div className="flex h-full flex-col justify-between">
                              <div className="flex items-center justify-between text-[11px] text-slate-700">
                                <span>{item?.name ?? "未設定"}</span>
                                <span>{durationLabel(block.len, planDensity)}</span>
                              </div>
                              <div className="text-sm font-semibold">
                                +{block.amount}
                                <span className="ml-1 text-xs text-slate-600">{item?.unit ?? ""}</span>
                              </div>
                              <div className="truncate text-[11px] text-slate-600">{block.memo || " "}</div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>

                  <div className="border-b p-3 text-xs">
                    {eodList.length ? (
                      <div className="space-y-1">
                        {eodList.map((entry) => (
                          <div key={`${entry.itemId}-${dayIdx}`} className="flex items-center justify-between">
                            <div className="font-medium text-slate-700">{entry.name}</div>
                            <div className="text-slate-600">
                              {entry.stock}
                              {entry.unit}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">生産なし</div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const openConstraintsDialog = () => {
    setConstraintsDraft(constraintsText);
    setGeminiHorizonDaysDraft(String(geminiHorizonDays));
    setConstraintsError(null);
    setConstraintsOpen(true);
  };

  const openCreateMaterialModal = () => {
    setMaterialDialogState({
      open: true,
      editingMaterialId: null,
    });
  };

  const openEditMaterialModal = (materialId: string) => {
    setMaterialDialogState({
      open: true,
      editingMaterialId: materialId,
    });
  };

  const viewLabelMap: Record<"schedule" | "inventory" | "master" | "import" | "manual", string> = {
    schedule: "スケジュール",
    inventory: "在庫データ",
    master: "マスタ管理",
    import: "Excel取り込み",
    manual: "マニュアル",
  };

  const masterViewLabelMap: Record<"home" | "items" | "materials" | "users", string> = {
    home: "マスタ管理",
    items: "マスタ管理 / 品目一覧",
    materials: "マスタ管理 / 原料一覧",
    users: "マスタ管理 / ユーザー管理",
  };

  const viewLabel = activeView === "master" ? masterViewLabelMap[masterSection] : viewLabelMap[activeView];
  const handleMasterHomeSelect = () => {
    setActiveView("master");
    setMasterSection("home");
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        認証情報を確認しています...
      </div>
    );
  }

  if (!authUser) {
    return (
      <LoginView
        loginId={loginId}
        loginPassword={loginPassword}
        loginError={loginError}
        authError={authError}
        loginBusy={loginBusy}
        onLoginIdChange={setLoginId}
        onLoginPasswordChange={setLoginPassword}
        onLogin={() => void handleLogin()}
      />
    );
  }

  return (
    <ManufacturingPlanLayout
      navOpen={navOpen}
      setNavOpen={setNavOpen}
      activeView={activeView}
      setActiveView={setActiveView}
      viewLabel={viewLabel}
      authUser={authUser}
      authRoleLabel={authRoleLabel}
      isReadOnly={isViewer}
      onLogout={() => void handleLogout()}
      onSelectMasterHome={handleMasterHomeSelect}
    >
      {isViewer ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          閲覧専用ユーザーのため、編集内容は保存されません。
        </div>
      ) : null}
      {activeView === "schedule"
        ? (
            <ScheduleView
              scheduleHeader={scheduleHeader}
              scheduleCard={scheduleCard}
              chatMessages={chatMessages}
              chatBusy={chatBusy}
              chatError={chatError}
              chatInput={chatInput}
              onChatInputChange={setChatInput}
              onSendChatMessage={() => void sendChatMessage()}
              onOpenConstraints={openConstraintsDialog}
              canUseChat={canUseChat}
              chatScrollRef={chatScrollRef}
            />
          )
        : activeView === "inventory"
          ? (
              <InventoryView
                inventoryItems={inventoryItems}
                inventoryDates={inventoryDates}
                dailyStocks={dailyStocks}
                dailyStockEntryMap={dailyStockEntryMap}
              />
            )
          : activeView === "master"
            ? (
                <MasterView
                  masterSection={masterSection}
                  onMasterSectionChange={setMasterSection}
                  items={items}
                  materialsMaster={materialsMaster}
                  managedUsers={managedUsers}
                  managedUsersNote={managedUsersNote}
                  managedUsersLoading={managedUsersLoading}
                  managedUsersError={managedUsersError}
                  canEdit={canManageMaster}
                  applySafetyStockForTargets={applySafetyStockForTargets}
                  openCreateItemModal={openCreateItemModal}
                  applySafetyStockForItem={applySafetyStockForItem}
                  openRecipeEdit={openRecipeEdit}
                  openEditItemModal={openEditItemModal}
                  openCreateMaterialModal={openCreateMaterialModal}
                  openEditMaterialModal={openEditMaterialModal}
                  openCreateManagedUserModal={openCreateManagedUserModal}
                  openEditManagedUserModal={openEditManagedUserModal}
                  onDeleteManagedUser={handleDeleteManagedUser}
                />
              )
            : activeView === "import"
              ? (
                  <ImportView
                    exportDailyStockCsv={exportDailyStockCsv}
                    dailyStocks={dailyStocks}
                    dailyStockUpdatedAt={dailyStockUpdatedAt}
                    dailyStockInputKey={dailyStockInputKey}
                    canImportDailyStock={canImportDailyStock}
                    canManageMasters={canManageMaster}
                    setDailyStockImportFile={setDailyStockImportFile}
                    setDailyStockImportNote={setDailyStockImportNote}
                    setDailyStockImportError={setDailyStockImportError}
                    dailyStockImportFile={dailyStockImportFile}
                    handleDailyStockImportClick={handleDailyStockImportClick}
                    saveImportHeaderOverrides={saveImportHeaderOverrides}
                    importHeaderSaveBusy={importHeaderSaveBusy}
                    dailyStockHeaderOverrides={dailyStockHeaderOverrides}
                    setDailyStockHeaderOverrides={setDailyStockHeaderOverrides}
                    importHeaderSaveNote={importHeaderSaveNote}
                    importHeaderSaveError={importHeaderSaveError}
                    dailyStockImportNote={dailyStockImportNote}
                    dailyStockImportError={dailyStockImportError}
                    exportItemMasterCsv={exportItemMasterCsv}
                    items={items}
                    itemMasterInputKey={itemMasterInputKey}
                    setItemMasterImportFile={setItemMasterImportFile}
                    setItemMasterImportNote={setItemMasterImportNote}
                    setItemMasterImportError={setItemMasterImportError}
                    itemMasterImportFile={itemMasterImportFile}
                    handleItemMasterImportClick={handleItemMasterImportClick}
                    itemMasterImportNote={itemMasterImportNote}
                    itemMasterImportError={itemMasterImportError}
                    exportMaterialMasterCsv={exportMaterialMasterCsv}
                    materialsMaster={materialsMaster}
                    materialMasterInputKey={materialMasterInputKey}
                    setMaterialMasterImportFile={setMaterialMasterImportFile}
                    setMaterialMasterImportNote={setMaterialMasterImportNote}
                    setMaterialMasterImportError={setMaterialMasterImportError}
                    materialMasterImportFile={materialMasterImportFile}
                    handleMaterialMasterImportClick={handleMaterialMasterImportClick}
                    materialMasterImportNote={materialMasterImportNote}
                    materialMasterImportError={materialMasterImportError}
                  />
                )
              : (
                  <ManualView manualAudience={manualAudience} onManualAudienceChange={setManualAudience} />
                )}

      <ManufacturingPlanDialogs
        userDialogModel={{
          open: isUserModalOpen,
          mode: userModalMode,
          editingUser,
          modalWideClassName,
          modalBodyClassName,
        }}
        onUserDialogOpenChange={(open) => {
          setIsUserModalOpen(open);
          if (!open) {
            setEditingUser(null);
          }
        }}
        onUserCreate={handleCreateManagedUser}
        onUserUpdate={handleUpdateManagedUser}
        itemDialogModel={{
          open: itemDialogState.open,
          mode: itemDialogState.mode,
          editingItemId: itemDialogState.editingItemId,
          items,
          modalWideClassName,
          modalBodyClassName,
          canEdit: canManageMaster,
        }}
        onItemDialogOpenChange={handleItemDialogOpenChange}
        onItemDialogSave={handleItemDialogSave}
        materialDialogModel={{
          open: materialDialogState.open,
          mode: materialDialogMode,
          editingMaterialId: materialDialogState.editingMaterialId,
          materialsMaster,
          setMaterialsMaster,
          setItems,
          setRecipeDraft,
          modalWideClassName,
          modalBodyClassName,
          canEdit: canManageMaster,
        }}
        onMaterialDialogOpenChange={handleMaterialDialogOpenChange}
        onMaterialDialogSave={handleMaterialSave}
        recipeDialogOpen={openRecipe}
        onRecipeDialogOpenChange={setOpenRecipe}
        activeRecipeItemName={activeRecipeItem?.name ?? null}
        activeRecipeItemUnit={activeRecipeItem?.unit ?? null}
        recipeDraft={recipeDraft}
        onRecipeDraftChange={setRecipeDraft}
        materialOptions={materialOptions}
        materialMap={materialMap}
        materialsMaster={materialsMaster}
        canEdit={canManageMaster}
        modalWideClassName={modalWideClassName}
        modalBodyClassName={modalBodyClassName}
        onRecipeSave={onRecipeSave}
        constraintsDialogOpen={constraintsOpen}
        onConstraintsDialogOpenChange={setConstraintsOpen}
        onConstraintsSave={() => void saveConstraints()}
        constraintsDialogModel={constraintsDialogModel}
        constraintsDialogActions={constraintsDialogActions}
        blockDetailDialogModel={blockDetailDialogModel}
        blockDetailDialogActions={blockDetailDialogActions}
        onPlanOpenChange={handlePlanOpenChange}
        onPlanSave={onPlanSave}
      />
    </ManufacturingPlanLayout>
  );
}
