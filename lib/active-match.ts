import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";
import { isMatchActivelyLive } from "@/lib/next-match";

export { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";

type MatchDateFields = { id: number; match_date?: unknown; fixture?: unknown; status?: unknown; last_synced_at?: unknown };

function parseLastSyncedMs(v: unknown): number {
  if (v == null) return 0;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : t;
}

/** Latest activity first (sync time), then higher id — “current match” should follow the fixture you last linked or synced. */
export function sortTrackedByRecency<T extends { id: number; last_synced_at?: unknown }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const tb = parseLastSyncedMs(b.last_synced_at);
    const ta = parseLastSyncedMs(a.last_synced_at);
    if (tb !== ta) return tb - ta;
    return b.id - a.id;
  });
}

/** All `is_current` rows, most recently synced first, then id desc (not “live only” — avoids sticking on an older LIVE row after you link/sync a newer fixture). */
export async function getActiveMatchIdsOrdered(): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, match_date, fixture, status, last_synced_at")
    .eq("is_current", true);
  const rows = (data ?? []) as MatchDateFields[];
  if (rows.length === 0) return [];
  const sorted = sortTrackedByRecency(rows);
  return sorted.map((r) => r.id);
}

/**
 * Pick which active match to show: URL ?m= wins, then cookie, else highest-id active row.
 */
export function pickShownMatchId(
  activeIds: number[],
  queryM: string | undefined,
  cookieVal: string | undefined | null
): number | null {
  if (activeIds.length === 0) return null;
  const q = queryM?.trim() ? parseInt(queryM, 10) : NaN;
  if (Number.isFinite(q) && activeIds.includes(q)) return q;
  const c = cookieVal?.trim() ? parseInt(String(cookieVal), 10) : NaN;
  if (Number.isFinite(c) && activeIds.includes(c)) return c;
  return activeIds[0] ?? null;
}

type Matchish = {
  id: number;
  is_current?: boolean;
  match_date?: unknown;
  fixture?: unknown;
  status?: unknown;
  last_synced_at?: unknown;
};

/**
 * Tabs list only **actively live** `is_current` matches (not finished, not stale tracked).
 * Shown row: `?m=` always wins when that id exists in the DB list (history / deep links), even if the
 * match is not `is_current` or not in the live tab set — otherwise cookie / **all** `is_current` rows
 * ordered by `last_synced_at` then id (not live-only, so a newer synced fixture beats an older LIVE one).
 */
export function pickTrackedMatchRowFromList<T extends Matchish>(
  matchesDescending: T[],
  queryM: string | undefined,
  cookieVal: string | undefined | null
): { activeTracked: T[]; activeTrackedForTabs: T[]; shownRow: T | null } {
  const activeTracked = sortTrackedByRecency(matchesDescending.filter((m) => m.is_current));
  const liveTracked = activeTracked.filter((m) => isMatchActivelyLive(m.status));
  const activeTrackedForTabs = liveTracked;

  const q = queryM?.trim() ? parseInt(queryM.trim(), 10) : NaN;
  if (Number.isFinite(q)) {
    const explicit = matchesDescending.find((m) => m.id === q);
    if (explicit) {
      return { activeTracked, activeTrackedForTabs, shownRow: explicit };
    }
  }

  const activeIdsOrdered = activeTracked.map((m) => m.id);
  if (activeIdsOrdered.length === 0) {
    return { activeTracked: [], activeTrackedForTabs: [], shownRow: matchesDescending[0] ?? null };
  }

  const shownId = pickShownMatchId(activeIdsOrdered, undefined, cookieVal);
  const shownRow = matchesDescending.find((m) => m.id === shownId) ?? activeTracked[0] ?? null;

  return { activeTracked, activeTrackedForTabs, shownRow };
}

/** Default match id for lineup / roster / refresh when body omits matchId. */
export async function resolveDefaultMatchIdFromPreferences(
  cookieVal: string | undefined | null
): Promise<number> {
  const activeIds = await getActiveMatchIdsOrdered();
  if (activeIds.length === 0) {
    const { data: fallback } = await supabaseAdmin
      .from("matches")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!fallback) throw new Error("Seed a match first.");
    return fallback.id as number;
  }
  const c = cookieVal?.trim() ? parseInt(String(cookieVal), 10) : NaN;
  if (Number.isFinite(c) && activeIds.includes(c)) return c;
  return activeIds[0]!;
}

export async function readActiveMatchCookieValue(): Promise<string | undefined> {
  try {
    return (await cookies()).get(ACTIVE_MATCH_COOKIE)?.value;
  } catch {
    return undefined;
  }
}

/** Full row for sync/refresh when no explicit matchId (respects cookie among is_current rows). */
export async function getDefaultActiveMatchRowForSync(): Promise<Record<string, unknown> | null> {
  const activeIds = await getActiveMatchIdsOrdered();
  let pickId: number | null = null;
  if (activeIds.length > 0) {
    const raw = await readActiveMatchCookieValue();
    pickId = pickShownMatchId(activeIds, undefined, raw);
  }
  if (pickId != null) {
    const { data } = await supabaseAdmin.from("matches").select("*").eq("id", pickId).maybeSingle();
    if (data) return data as Record<string, unknown>;
  }
  const { data: fallback } = await supabaseAdmin
    .from("matches")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (fallback as Record<string, unknown> | null) ?? null;
}
