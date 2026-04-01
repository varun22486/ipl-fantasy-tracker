/**
 * Valid positive DB id from ?c= or active_comp cookie string.
 * Matches server resolveCompetitionId parsing.
 */
export function parseCompetitionId(raw: string | undefined | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n !== Math.floor(n)) return null;
  return n;
}

/** Client: read active_comp (same cookie CompetitionSwitcher sets on league change). */
export function readActiveCompetitionIdFromCookie(): number | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )active_comp=([^;]*)/);
  if (!m?.[1]) return null;
  try {
    return parseCompetitionId(decodeURIComponent(m[1].trim()));
  } catch {
    return parseCompetitionId(m[1].trim());
  }
}
