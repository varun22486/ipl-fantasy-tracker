/**
 * Washouts / no-result / abandoned fixtures — fantasy points must not count toward standings or stats.
 */

function containsVoidOutcomeSignal(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const u = raw.toUpperCase();
  const low = raw.toLowerCase();

  if (u === "ABANDONED") return true;
  if (u === "NO_RESULT" || u.includes("NO RESULT")) return true;
  if (u === "NR" || /\bNR\b/.test(u)) return true;

  if (low.includes("wash")) return true;
  if (/\bno\s+result\b/.test(low)) return true;
  if (low.includes("abandon")) return true;
  if (/\bmatch\s+(?:abandoned|called off)\b/.test(low)) return true;

  return false;
}

/**
 * True when this match must contribute zero fantasy points everywhere (DB is zeroed on sync; reads also guard stale rows).
 * @param fantasyVoided — manual void from `matches.fantasy_voided` (user/admin).
 */
export function isPointsVoidedMatchStatus(status?: unknown, liveSummary?: unknown, fantasyVoided?: unknown): boolean {
  if (fantasyVoided === true) return true;
  if (containsVoidOutcomeSignal(String(status ?? ""))) return true;
  const sum = String(liveSummary ?? "").trim();
  return Boolean(sum && containsVoidOutcomeSignal(sum));
}

/** All scoring columns cleared for voided matches (sync path). */
export const VOIDED_MATCH_FANTASY_SCORES = {
  runs: 0,
  wickets: 0,
  catches: 0,
  runouts: 0,
  stumpings: 0,
  fifty_bonus: 0,
  hundred_bonus: 0,
  three_w_bonus: 0,
  five_w_bonus: 0,
  mom_bonus: 0,
  provider_player_id: null as string | null,
} as const;
