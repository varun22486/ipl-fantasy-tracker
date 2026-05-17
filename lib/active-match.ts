import { cookies } from "next/headers";
import { parseLeagueMatchNumberFromFixture } from "@/lib/format";
import { canonicalIstDayForIpl2026LeagueMatch } from "@/lib/ipl-2026-league-dates";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";
import { isMatchActivelyLive, iplCalendarTodayIso, normalizeMatchDateKey } from "@/lib/next-match";

export { ACTIVE_MATCH_COOKIE } from "@/lib/active-match-constants";

type MatchDateFields = { id: number; match_date?: unknown; fixture?: unknown; status?: unknown; last_synced_at?: unknown };

function parseLastSyncedMs(v: unknown): number {
  if (v == null) return 0;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Which `is_current` row to treat as primary: later IPL calendar day first (so Match 17 beats 16 even
 * when 16 has a newer `last_synced_at` from yesterday), then last_sync, then id.
 */
export function sortTrackedByRecency<T extends { id: number; last_synced_at?: unknown; match_date?: unknown }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const db = normalizeMatchDateKey(b.match_date);
    const da = normalizeMatchDateKey(a.match_date);
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      const c = db.localeCompare(da);
      if (c !== 0) return c;
    }

    const tb = parseLastSyncedMs(b.last_synced_at);
    const ta = parseLastSyncedMs(a.last_synced_at);
    if (tb !== ta) return tb - ta;
    return b.id - a.id;
  });
}

/** All `is_current` rows: later `match_date` first, then last_sync, then id (avoids sticking on yesterday’s row when today’s has no sync time yet). */
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
 * Pick which active match to show among `is_current` rows: explicit `?m=` when that id is still
 * tracked as current, else the primary row from `sortTrackedByRecency` (newest schedule day first).
 * Browser cookies are intentionally not used here — they kept forcing an older `is_current` fixture
 * when a newer IPL day was also tracked, and nav was appending stale `?m=` from the same cookie.
 */
export function pickShownMatchId(activeIds: number[], queryM: string | undefined): number | null {
  if (activeIds.length === 0) return null;
  const q = queryM?.trim() ? parseInt(queryM, 10) : NaN;
  if (Number.isFinite(q) && activeIds.includes(q)) return q;
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
 * True when this row’s schedule day (DB date, or sparse IPL 2026 league # map) equals `todayIso` (IST).
 * Aligns with `effectiveScheduleDateKeyForMatch` in `next-match` without importing a circular graph.
 */
export function isTrackedMatchOnCalendarIstDay(m: Matchish, todayIso: string): boolean {
  const key = normalizeMatchDateKey(m.match_date);
  if (key === todayIso) return true;
  const fixture = typeof m.fixture === "string" ? m.fixture : "";
  const n = parseLeagueMatchNumberFromFixture(fixture);
  if (n == null) return false;
  const canon = canonicalIstDayForIpl2026LeagueMatch(n);
  return canon === todayIso;
}

export type ActiveTabsScope = "today" | "live";

/**
 * Tabs: (1) two or more `is_current` fixtures on the **same IST calendar day** as today (double-headers,
 * including SCHEDULED), or (2) otherwise same as before — **live** `is_current` rows (in-play).
 * Shown row: `?m=` wins when that id exists in the DB list; else primary from `sortTrackedByRecency`.
 */
export function pickTrackedMatchRowFromList<T extends Matchish>(
  matchesDescending: T[],
  queryM: string | undefined,
  options?: { todayIstIso?: string }
): { activeTracked: T[]; activeTrackedForTabs: T[]; shownRow: T | null; activeTabsScope: ActiveTabsScope } {
  const todayIso = options?.todayIstIso ?? iplCalendarTodayIso();
  const activeTracked = sortTrackedByRecency(matchesDescending.filter((m) => m.is_current));
  const liveTracked = activeTracked.filter((m) => isMatchActivelyLive(m.status));
  const todayTracked = activeTracked.filter((m) => isTrackedMatchOnCalendarIstDay(m, todayIso));

  let activeTrackedForTabs: T[];
  let activeTabsScope: ActiveTabsScope;
  if (todayTracked.length >= 2) {
    activeTrackedForTabs = sortTrackedByRecency(todayTracked);
    activeTabsScope = "today";
  } else {
    activeTrackedForTabs = liveTracked;
    activeTabsScope = "live";
  }

  const q = queryM?.trim() ? parseInt(queryM.trim(), 10) : NaN;
  if (Number.isFinite(q)) {
    const explicit = matchesDescending.find((m) => m.id === q);
    if (explicit) {
      return { activeTracked, activeTrackedForTabs, shownRow: explicit, activeTabsScope };
    }
  }

  const activeIdsOrdered = activeTracked.map((m) => m.id);
  if (activeIdsOrdered.length === 0) {
    return { activeTracked: [], activeTrackedForTabs: [], shownRow: matchesDescending[0] ?? null, activeTabsScope };
  }

  const shownId = pickShownMatchId(activeIdsOrdered, undefined);
  const shownRow = matchesDescending.find((m) => m.id === shownId) ?? activeTracked[0] ?? null;

  return { activeTracked, activeTrackedForTabs, shownRow, activeTabsScope };
}

function fixtureKey(fixture: unknown): string {
  return String(fixture ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function firstWithLineups<T extends Matchish>(rows: T[], lineupMatchIds: ReadonlySet<number>): T | null {
  if (lineupMatchIds.size === 0) return null;
  const hits = sortTrackedByRecency(rows.filter((m) => lineupMatchIds.has(m.id)));
  return hits[0] ?? null;
}

/**
 * Like {@link pickTrackedMatchRowFromList}, but when `?m=` is omitted prefers an `is_current` (or tab-pool)
 * row that already has saved lineups for the active competition. Falls back to another DB row with the same
 * fixture string when the primary pick has no lineups (duplicate match rows for one IPL fixture).
 */
export function pickTrackedMatchRowWithLineupPreference<T extends Matchish>(
  matchesDescending: T[],
  queryM: string | undefined,
  lineupMatchIds: ReadonlySet<number>,
  options?: { todayIstIso?: string }
): ReturnType<typeof pickTrackedMatchRowFromList<T>> {
  const base = pickTrackedMatchRowFromList(matchesDescending, queryM, options);
  const q = queryM?.trim() ? parseInt(queryM.trim(), 10) : NaN;
  if (Number.isFinite(q) || lineupMatchIds.size === 0) return base;

  const { shownRow, activeTracked, activeTrackedForTabs } = base;
  if (shownRow && lineupMatchIds.has(shownRow.id)) return base;

  const pools: T[][] = [activeTrackedForTabs, activeTracked, matchesDescending.filter((m) => m.is_current)];
  for (const pool of pools) {
    const preferred = firstWithLineups(pool, lineupMatchIds);
    if (preferred) return { ...base, shownRow: preferred };
  }

  if (shownRow) {
    const fk = fixtureKey(shownRow.fixture);
    if (fk) {
      const sameFixture = firstWithLineups(
        matchesDescending.filter((m) => fixtureKey(m.fixture) === fk),
        lineupMatchIds
      );
      if (sameFixture) return { ...base, shownRow: sameFixture };
    }

    const leagueN = parseLeagueMatchNumberFromFixture(
      typeof shownRow.fixture === "string" ? shownRow.fixture : String(shownRow.fixture ?? "")
    );
    if (leagueN != null) {
      const sameLeague = firstWithLineups(
        matchesDescending.filter(
          (m) =>
            parseLeagueMatchNumberFromFixture(
              typeof m.fixture === "string" ? m.fixture : String(m.fixture ?? "")
            ) === leagueN
        ),
        lineupMatchIds
      );
      if (sameLeague) return { ...base, shownRow: sameLeague };
    }
  }

  const anyWithLineup = firstWithLineups(matchesDescending, lineupMatchIds);
  if (anyWithLineup) return { ...base, shownRow: anyWithLineup };

  return base;
}

/** Default match id for lineup / roster / refresh when body omits matchId. */
export async function resolveDefaultMatchIdFromPreferences(
  _cookieVal: string | undefined | null
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
    pickId = pickShownMatchId(activeIds, undefined);
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
