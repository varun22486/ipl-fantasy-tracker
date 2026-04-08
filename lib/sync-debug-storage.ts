/**
 * Client-only: last sync / seed / matches-today JSON for the Debug page.
 * Session scope — cleared when the tab closes.
 */

export const SYNC_DEBUG_STORAGE_KEY = "ipl_app_sync_debug_v1";

export type SyncDebugRecord = {
  recordedAt: string;
  matchId: number | null;
  /** e.g. refresh | match-detail-sync | match-detail | dashboard */
  source?: string;
  payload: Record<string, unknown>;
};

export function recordSyncDebugClient(
  matchId: number | null | undefined,
  payload: Record<string, unknown>,
  source?: string
) {
  if (typeof window === "undefined") return;
  try {
    const rec: SyncDebugRecord = {
      recordedAt: new Date().toISOString(),
      matchId: matchId == null || !Number.isFinite(matchId) ? null : matchId,
      source,
      payload,
    };
    sessionStorage.setItem(SYNC_DEBUG_STORAGE_KEY, JSON.stringify(rec));
  } catch {
    /* quota / private mode */
  }
}

export function readSyncDebugClient(): SyncDebugRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SYNC_DEBUG_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as SyncDebugRecord;
    if (!o || typeof o !== "object" || !o.payload || typeof o.payload !== "object") return null;
    return o;
  } catch {
    return null;
  }
}

export function clearSyncDebugClient() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SYNC_DEBUG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
