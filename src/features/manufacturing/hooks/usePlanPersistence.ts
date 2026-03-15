import { useState, useRef, useEffect } from "react";
import type { PlanPayload } from "@/types/planning";

interface UsePlanPersistenceParams {
  withCsrfHeader: (headers?: Record<string, string>) => Record<string, string>;
}

export interface UsePlanPersistenceReturn {
  isPlanLoaded: boolean;
  setIsPlanLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  hasHydratedPlan: boolean;
  setHasHydratedPlan: React.Dispatch<React.SetStateAction<boolean>>;
  planLoadError: string | null;
  setPlanLoadError: React.Dispatch<React.SetStateAction<string | null>>;
  planSaveStatus: "idle" | "saving" | "success" | "error";
  setPlanSaveStatus: React.Dispatch<React.SetStateAction<"idle" | "saving" | "success" | "error">>;
  planSaveError: string | null;
  setPlanSaveError: React.Dispatch<React.SetStateAction<string | null>>;
  // 自動保存 debounce 用（主コンポーネントの useEffect で使用）
  planSaveDebounceTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  queuedPlanPayloadRef: React.MutableRefObject<PlanPayload | null>;
  hasQueuedPlanPayloadRef: React.MutableRefObject<boolean>;
  lastAutoSaveSkipReasonRef: React.MutableRefObject<string | null>;
  postPlanPayload: (payload: PlanPayload) => Promise<void>;
}

export function usePlanPersistence({
  withCsrfHeader,
}: UsePlanPersistenceParams): UsePlanPersistenceReturn {
  const [isPlanLoaded, setIsPlanLoaded] = useState(false);
  const [hasHydratedPlan, setHasHydratedPlan] = useState(false);
  const [planLoadError, setPlanLoadError] = useState<string | null>(null);
  const [planSaveStatus, setPlanSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [planSaveError, setPlanSaveError] = useState<string | null>(null);

  // 保存リクエストのキュー管理
  const planSaveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const planSaveAbortControllerRef = useRef<AbortController | null>(null);
  const planSaveInFlightRef = useRef(false);
  const queuedPlanPayloadRef = useRef<PlanPayload | null>(null);
  const hasQueuedPlanPayloadRef = useRef(false);
  const lastAutoSaveSkipReasonRef = useRef<string | null>(null);

  // アンマウント時にタイマーとリクエストをクリーンアップ
  useEffect(() => {
    return () => {
      if (planSaveDebounceTimerRef.current !== null) {
        clearTimeout(planSaveDebounceTimerRef.current);
      }
      planSaveAbortControllerRef.current?.abort();
    };
  }, []);

  const postPlanPayload = async (payload: PlanPayload): Promise<void> => {
    if (planSaveInFlightRef.current) {
      queuedPlanPayloadRef.current = payload;
      hasQueuedPlanPayloadRef.current = true;
      return;
    }

    planSaveInFlightRef.current = true;
    setPlanSaveStatus("saving");
    setPlanSaveError(null);
    const controller = new AbortController();
    planSaveAbortControllerRef.current = controller;

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: withCsrfHeader({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`保存に失敗しました。（HTTP ${response.status}）`);
      }
      setPlanSaveStatus("success");
      setPlanSaveError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : "保存に失敗しました。";
      setPlanSaveStatus("error");
      setPlanSaveError(message);
    } finally {
      if (planSaveAbortControllerRef.current === controller) {
        planSaveAbortControllerRef.current = null;
      }
      planSaveInFlightRef.current = false;

      if (hasQueuedPlanPayloadRef.current && queuedPlanPayloadRef.current) {
        const latestPayload = queuedPlanPayloadRef.current;
        hasQueuedPlanPayloadRef.current = false;
        queuedPlanPayloadRef.current = null;
        void postPlanPayload(latestPayload);
      }
    }
  };

  return {
    isPlanLoaded,
    setIsPlanLoaded,
    hasHydratedPlan,
    setHasHydratedPlan,
    planLoadError,
    setPlanLoadError,
    planSaveStatus,
    setPlanSaveStatus,
    planSaveError,
    setPlanSaveError,
    planSaveDebounceTimerRef,
    queuedPlanPayloadRef,
    hasQueuedPlanPayloadRef,
    lastAutoSaveSkipReasonRef,
    postPlanPayload,
  };
}
