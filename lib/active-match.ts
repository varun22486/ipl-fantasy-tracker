import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";
import {
  effectiveScheduleDateKeyForMatch,
  iplCalendarTodayIso,
  isMatchActivelyLive,
} from "@/lib/next-match";

export { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";

type MatchDateFields = { id: number; match_date?: unknown; fixture?: unknown; status?: unknown };

function filterTrackedToIplToday<T extends MatchDateFields>(rows: T[]): T[] {
  const today = iplCalendarTodayIso();
  const onDay = rows.filter((r) => {
    const d = effectiveScheduleDateKeyForMatch(r);
    return d !== "" && d === today;
  });
  return onDay.length > 0 ? onDay : rows;
}

/** Prefer truly live `is_current` rows; else same calendar-day filter as before. Id desc. */
export async function getActiveMatchIdsOrdered(): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from("matches")
    .select("id, match_date, fixture, status")
    .eq("is_current", true)
    .order("id", { ascending: false });
  const rows = (data ?? []) as MatchDateFields[];
  const live = rows.filter((r) => isMatchActivelyLive(r.status));
  if (live.length > 0) return live.map((r) => r.id);
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

type Matchish = { id: number; is_current?: boolean; match_date?: unknown; fixture?: unknown; status?: unknown };

/**
 * Tabs list only **actively live** `is_current` matches (not finished, not stale tracked).
 * Shown row: `?m=` always wins when that id exists in the DB list (history / deep links), even if the
 * match is not `is_current` or not in the live tab set — otherwise cookie / live pool fallback.
 */
export function pickTrackedMatchRowFromList<T extends Matchish>(
  matchesDescending: T[],
  queryM: string | undefined,
  cookieVal: string | undefined | null
): { activeTracked: T[]; activeTrackedForTabs: T[]; shownRow: T | null } {
  const activeTracked = matchesDescending.filter((m) => m.is_current).sort((a, b) => b.id - a.id);
  const liveTracked = activeTracked.filter((m) => isMatchActivelyLive(m.status));
  const activeTrackedForTabs = liveTracked;

  const q = queryM?.trim() ? parseInt(queryM.trim(), 10) : NaN;
  if (Number.isFinite(q)) {
    const explicit = matchesDescending.find((m) => m.id === q);
    if (explicit) {
      return { activeTracked, activeTrackedForTabs, shownRow: explicit };
    }
  }

  const activeIds = activeTracked.map((m) => m.id);
  if (activeIds.length === 0) {
    return { activeTracked: [], activeTrackedForTabs: [], shownRow: matchesDescending[0] ?? null };
  }

  const today = iplCalendarTodayIso();
  const onToday = activeTracked.filter((m) => {
    const d = effectiveScheduleDateKeyForMatch(m);
    return d !== "" && d === today;
  });
  const fallbackPool = onToday.length > 0 ? onToday : activeTracked;

  let shownRow: T | null = null;
  if (liveTracked.length > 0) {
    const tabIds = liveTracked.map((m) => m.id);
    const shownId = pickShownMatchId(tabIds, undefined, cookieVal);
    shownRow = matchesDescending.find((m) => m.id === shownId) ?? liveTracked[0] ?? null;
  } else {
    const fbIds = fallbackPool.map((m) => m.id);
    const shownId = pickShownMatchId(fbIds, undefined, cookieVal);
    shownRow = matchesDescending.find((m) => m.id === shownId) ?? fallbackPool[0] ?? null;
  }

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
