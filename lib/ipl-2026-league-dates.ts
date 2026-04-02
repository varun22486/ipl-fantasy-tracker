/**
 * IPL 2026 league match # → IST listing day (YYYY-MM-DD).
 * Sparse: add rows as you verify against the official schedule. When a number is listed here,
 * home/next-match display prefers this day together with the league # parsed from the fixture.
 */
const IPL_2026_LEAGUE_IST_DAY: Partial<Record<number, string>> = {
  7: "2026-04-03",
  8: "2026-04-04",
};

export function canonicalIstDayForIpl2026LeagueMatch(leagueMatchNo: number | null | undefined): string | undefined {
  if (leagueMatchNo == null || !Number.isFinite(leagueMatchNo)) return undefined;
  return IPL_2026_LEAGUE_IST_DAY[Math.trunc(leagueMatchNo)];
}
