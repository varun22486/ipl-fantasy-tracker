/**
 * Pick the next match users should care about for lineup / hero CTAs.
 * Uses India calendar dates (IPL) and schedule order — not DB insert id alone.
 */

import { parseLeagueMatchNumberFromFixture } from "@/lib/format";
import { canonicalIstDayForIpl2026LeagueMatch } from "@/lib/ipl-2026-league-dates";

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

/** True only when the feed looks in-play, not a final (e.g. "Live: … won by …" → false). */
export function isFinishedMatchStatusString(status: string): boolean {
  const u = status.toUpperCase();
  if (u === "COMPLETED") return true;
  if (u === "ABANDONED") return true;
  if (u === "NO_RESULT" || u.includes("NO RESULT")) return true;
  const low = status.toLowerCase();
  return (
    low.includes("won by") ||
    /\bbeat\b/.test(low) ||
    low.includes("match tied") ||
    low.includes("match drawn")
  );
}

export function isMatchActivelyLive(status: unknown): boolean {
  const s = String(status ?? "").trim();
  if (!s) return false;
  if (isFinishedMatchStatusString(s)) return false;
  return isLiveMatchStatus(status);
}

export type MatchRow = { id: number; match_date?: unknown; status?: unknown; fixture?: unknown };

function leagueMatchSortKey(m: MatchRow): number {
  const n = parseLeagueMatchNumberFromFixture(typeof m.fixture === "string" ? m.fixture : "");
  return n ?? 9999;
}

/** Prefer published league day for known 2026 match #s so bad provider/DB dates do not reorder the schedule. */
export function effectiveScheduleDateKeyForMatch(m: MatchRow): string {
  const n = parseLeagueMatchNumberFromFixture(typeof m.fixture === "string" ? m.fixture : "");
  const canon = canonicalIstDayForIpl2026LeagueMatch(n);
  if (canon) return canon;
  return normalizeMatchDateKey(m.match_date);
}

/**
 * Unplayed = no fantasy_players rows for that match_id.
 * Priority: unplayed LIVE (soonest by match_date, then league match #), else earliest unplayed
 * with match_date >= today (IPL), tie-broken by league match # then id.
 */
export function pickNextUnplayedMatch<T extends MatchRow>(matches: T[], matchIdsWithPlayers: Set<number>): T | null {
  const today = iplCalendarTodayIso();
  const unplayed = matches.filter((m) => !matchIdsWithPlayers.has(m.id));

  const bySchedule = (a: T, b: T) => {
    const da = effectiveScheduleDateKeyForMatch(a);
    const db = effectiveScheduleDateKeyForMatch(b);
    const c = da.localeCompare(db);
    if (c !== 0) return c;
    const na = leagueMatchSortKey(a);
    const nb = leagueMatchSortKey(b);
    if (na !== nb) return na - nb;
    return a.id - b.id;
  };

  const live = unplayed.filter((m) => isLiveMatchStatus(m.status));
  if (live.length) return [...live].sort(bySchedule)[0] ?? null;

  const upcoming = unplayed.filter((m) => {
    const d = effectiveScheduleDateKeyForMatch(m);
    return d !== "" && d >= today;
  });
  if (upcoming.length) return [...upcoming].sort(bySchedule)[0] ?? null;

  return null;
}
