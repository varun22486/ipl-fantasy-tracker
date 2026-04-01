/**
 * Pick the next match users should care about for lineup / hero CTAs.
 * Uses India calendar dates (IPL) and schedule order — not DB insert id alone.
 */

const IPL_TZ = "Asia/Kolkata";

export function iplCalendarTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IPL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Normalize DB/API date to YYYY-MM-DD for string compare. */
export function normalizeMatchDateKey(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IPL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

export function isLiveMatchStatus(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "live" || s.includes("live");
}

export type MatchRow = { id: number; match_date?: unknown; status?: unknown };

/**
 * Unplayed = no fantasy_players rows for that match_id.
 * Priority: unplayed LIVE (soonest by match_date), else earliest unplayed with match_date >= today (IPL).
 */
export function pickNextUnplayedMatch<T extends MatchRow>(matches: T[], matchIdsWithPlayers: Set<number>): T | null {
  const today = iplCalendarTodayIso();
  const unplayed = matches.filter((m) => !matchIdsWithPlayers.has(m.id));

  const bySchedule = (a: T, b: T) => {
    const da = normalizeMatchDateKey(a.match_date);
    const db = normalizeMatchDateKey(b.match_date);
    const c = da.localeCompare(db);
    if (c !== 0) return c;
    return a.id - b.id;
  };

  const live = unplayed.filter((m) => isLiveMatchStatus(m.status));
  if (live.length) return [...live].sort(bySchedule)[0] ?? null;

  const upcoming = unplayed.filter((m) => {
    const d = normalizeMatchDateKey(m.match_date);
    return d !== "" && d >= today;
  });
  if (upcoming.length) return [...upcoming].sort(bySchedule)[0] ?? null;

  return null;
}
