export type PlanDatabase = {
  close: () => void;
};

export const PLAN_DB_PATH: string;
export function openPlanDatabase(): Promise<PlanDatabase>;
export function loadPlanPayload(
  db: PlanDatabase,
  options?: { from?: string; to?: string; itemId?: string; itemName?: string }
): unknown;
export function loadDailyStocks(db: PlanDatabase): unknown;
export function loadImportHeaderOverrides(db: PlanDatabase): unknown;
export function saveImportHeaderOverrides(db: PlanDatabase, payload: unknown): unknown;
export function savePlanPayload(db: PlanDatabase, payload: unknown): unknown;
export function saveDailyStocks(db: PlanDatabase, entries?: unknown[]): unknown;
