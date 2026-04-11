/** Minimum time between score syncs unless the user confirms a forced refresh. */

export const REFRESH_COOLDOWN_MS = 15 * 60 * 1000;

export function isWithinRefreshCooldown(lastSyncedAtIso: string | null | undefined): boolean {
  if (!lastSyncedAtIso) return false;
  const t = new Date(lastSyncedAtIso).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < REFRESH_COOLDOWN_MS;
}

/** Whole minutes until a free sync (no confirm); null if sync is allowed now or time unknown. */
export function minutesUntilRefreshAllowed(lastSyncedAtIso: string | null | undefined): number | null {
  if (!lastSyncedAtIso) return null;
  const t = new Date(lastSyncedAtIso).getTime();
  if (!Number.isFinite(t)) return null;
  const leftMs = REFRESH_COOLDOWN_MS - (Date.now() - t);
  if (leftMs <= 0) return null;
  return Math.max(1, Math.ceil(leftMs / 60_000));
}
