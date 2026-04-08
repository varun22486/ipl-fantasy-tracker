import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";
import { effectiveScheduleDateKeyForMatch, iplCalendarTodayIso } from "@/lib/next-match";

export { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";

type MatchDateFields = { id: number; match_date?: unknown; fixture?: unknown };

function filterTrackedToIplToday<T extends MatchDateFields>(rows: T[]): T[] {
  const today = iplCalendarTodayIso();
  const onDay = rows.filter((r) => {
    const d = effectiveScheduleDateKeyForMatch(r);
    return d !== "" && d === today;
  });
  return onDay.length > 0 ? onDay : rows;
}

/** `is_current` rows for the IPL calendar day (IST), else all `is_current` if none have a usable date. Id desc. */
export async function getActiveMatchIdsOrdered(): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, match_date, fixture")
    .eq("is_current", true)
    .order("id", { ascending: false });
  const rows = (data ?? []) as MatchDateFields[];
  return filterTrackedToIplToday(rows).map((r) => r.id);
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

type Matchish = { id: number; is_current?: boolean; match_date?: unknown; fixture?: unknown };

/**
 * `matchesDescending` — e.g. from DB ordered by id desc.
 * When no row has `is_current`, falls back to latest match (first row) for legacy DBs.
 * Tabs use only fixtures on today's IPL calendar date when dates are known, so stale
 * `is_current` rows from earlier days do not all appear as "matches today".
 */
export function pickTrackedMatchRowFromList<T extends Matchish>(
  matchesDescending: T[],
  queryM: string | undefined,
  cookieVal: string | undefined | null
): { activeTracked: T[]; activeTrackedForTabs: T[]; tabsAreTodayOnly: boolean; shownRow: T | null } {
  const activeTracked = matchesDescending.filter((m) => m.is_current).sort((a, b) => b.id - a.id);
  const activeIds = activeTracked.map((m) => m.id);
  if (activeIds.length === 0) {
    return { activeTracked: [], activeTrackedForTabs: [], tabsAreTodayOnly: false, shownRow: matchesDescending[0] ?? null };
  }
  const today = iplCalendarTodayIso();
  const onToday = activeTracked.filter((m) => {
    const d = effectiveScheduleDateKeyForMatch(m);
    return d !== "" && d === today;
  });
  const tabsAreTodayOnly = onToday.length > 0;
  const activeTrackedForTabs = tabsAreTodayOnly ? onToday : activeTracked;
  const tabIds = activeTrackedForTabs.map((m) => m.id);
  const shownId = pickShownMatchId(tabIds, queryM, cookieVal);
  const shownRow = matchesDescending.find((m) => m.id === shownId) ?? activeTrackedForTabs[0] ?? null;
  return { activeTracked, activeTrackedForTabs, tabsAreTodayOnly, shownRow };
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
