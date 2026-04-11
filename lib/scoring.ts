export type FantasyPlayer = {
  id?: number;
  side: "You" | "Rahul";
  name: string;
  captain: boolean;
  /** Super sub: stats sync but points do not count until swapped into the playing 4. */
  bench?: boolean;
  runs: number;
  wickets: number;
  catches: number;
  /** Fielding credits for run-outs (each assisting fielder counts as 1). */
  runouts?: number;
  /** Wicket-keeper stumpings credited on the scorecard. */
  stumpings?: number;
  fifty_bonus: number;
  hundred_bonus: number;
  three_w_bonus: number;
  five_w_bonus: number;
  mom_bonus: number;
  /** CricAPI player id — optional, from DB. */
  provider_player_id?: string | null;
};

export type ScoringRules = {
  run: number; wicket: number; catch: number; runout: number; stump: number;
  fifty: number; hundred: number;
  threeW: number; fiveW: number; mom: number;
};

export const DEFAULT_SCORING: ScoringRules = {
  run: 1, wicket: 20, catch: 10, runout: 10, stump: 10,
  fifty: 10, hundred: 20,
  threeW: 10, fiveW: 20, mom: 10,
};

/** Build a ScoringRules object from DB settings row (falls back to defaults). */
export function scoringFromSettings(s: Record<string, unknown> | null | undefined): ScoringRules {
  if (!s) return DEFAULT_SCORING;
  return {
    run:    Number(s.pts_run     ?? DEFAULT_SCORING.run),
    wicket: Number(s.pts_wicket  ?? DEFAULT_SCORING.wicket),
    catch:  Number(s.pts_catch   ?? DEFAULT_SCORING.catch),
    runout: Number(s.pts_runout  ?? DEFAULT_SCORING.runout),
    stump:  Number(s.pts_stump   ?? DEFAULT_SCORING.stump),
    fifty:  Number(s.pts_fifty   ?? DEFAULT_SCORING.fifty),
    hundred:Number(s.pts_hundred ?? DEFAULT_SCORING.hundred),
    threeW: Number(s.pts_three_w ?? DEFAULT_SCORING.threeW),
    fiveW:  Number(s.pts_five_w  ?? DEFAULT_SCORING.fiveW),
    mom:    Number(s.pts_mom     ?? DEFAULT_SCORING.mom),
  };
}

/** Legacy alias so existing call-sites that don't pass custom rules still work. */
export const scoring = DEFAULT_SCORING;

/**
 * Super sub / bench row — only explicit truthy bench flags count.
 * Avoids JS truthiness bugs (e.g. some payloads use the string "false", which would still be truthy).
 */
export function isFantasyBench(p: { bench?: unknown } | null | undefined): boolean {
  const v = p?.bench;
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v === null || v === undefined) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

/** Playing XI first, then super subs; stable by row id within each group. */
export function sortFantasyLineupForDisplay<T extends { id?: number; bench?: unknown }>(players: T[]): T[] {
  return [...players].sort((a, b) => {
    const ab = isFantasyBench(a) ? 1 : 0;
    const bb = isFantasyBench(b) ? 1 : 0;
    if (ab !== bb) return ab - bb;
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

/** Fantasy points that count toward team totals (0 for bench / super sub). */
export function fantasyPointsCounted(p: FantasyPlayer, rules: ScoringRules = DEFAULT_SCORING): number {
  if (isFantasyBench(p)) return 0;
  return playerPoints(p, rules).final;
}

export function playerPoints(p: FantasyPlayer, rules: ScoringRules = DEFAULT_SCORING) {
  // 100+ runs: only the century tier counts (not 50 + 100).
  const fiftyTier = p.hundred_bonus ? 0 : p.fifty_bonus;
  const base =
    p.runs          * rules.run    +
    p.wickets       * rules.wicket +
    p.catches       * rules.catch  +
    (p.runouts ?? 0) * rules.runout +
    (p.stumpings ?? 0) * rules.stump +
    fiftyTier       * rules.fifty  +
    p.hundred_bonus * rules.hundred +
    p.three_w_bonus * rules.threeW +
    p.five_w_bonus  * rules.fiveW  +
    p.mom_bonus     * rules.mom;

   return {
    base,
    final: p.captain ? base * 2 : base,
  };
}

export function teamPoints(players: FantasyPlayer[]) {
  return players.reduce((sum, p) => sum + fantasyPointsCounted(p), 0);
}

/** Single table cell: catches / run-outs / stumpings */
export function formatCtRoSt(p: { catches: number; runouts?: number; stumpings?: number }) {
  return `${p.catches}/${p.runouts ?? 0}/${p.stumpings ?? 0}`;
}
