/** Shared helpers for “all keys” quota display (hits today vs combined daily cap). */

export const FALLBACK_QUOTA_CAP = 1200;

export type KeyStatsApiResponse = {
  ok?: boolean;
  totalHits?: number;
  keyCount?: number;
  keyLimit?: number;
  stats?: unknown[];
};

export function combinedQuotaCap(json: KeyStatsApiResponse | null | undefined): number {
  if (!json?.ok || typeof json.keyCount !== "number" || typeof json.keyLimit !== "number") {
    return FALLBACK_QUOTA_CAP;
  }
  return Math.max(1, json.keyCount * json.keyLimit);
}

export function combinedHitsFromKeyStats(json: KeyStatsApiResponse | null | undefined): number | null {
  if (!json?.ok || typeof json.totalHits !== "number") return null;
  return Math.max(0, json.totalHits);
}

export function anyKeyBlocked(
  stats: Array<{ blocked?: boolean }> | null | undefined,
): boolean {
  return Array.isArray(stats) && stats.some((s) => s.blocked);
}
