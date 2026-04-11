/** Minimum time between score syncs unless the user confirms a forced refresh. */

export const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

export function isWithinRefreshCooldown(lastSyncedAtIso: string | null | undefined): boolean {
  if (!lastSyncedAtIso) return false;
  const t = new Date(lastSyncedAtIso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < REFRESH_COOLDOWN_MS;
}

/** @returns true if the user chose to continue (forced refresh). */
export function confirmRefreshDespiteCooldown(): boolean {
  if (typeof window === "undefined") return false;
  return window.confirm(
    "We have limited API keys. Scores were synced within the last 15 minutes.\n\nRefresh again only if you need the latest data.\n\nContinue?",
  );
}
