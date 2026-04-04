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

/** Fantasy points that count toward team totals (0 for bench / super sub). */
export function fantasyPointsCounted(p: FantasyPlayer, rules: ScoringRules = DEFAULT_SCORING): number {
  if (p.bench) return 0;
  return playerPoints(p, rules).final;
}

export function playerPoints(p: FantasyPlayer, rules: ScoringRules = DEFAULT_SCORING) {
  const base =
    p.runs          * rules.run    +
    p.wickets       * rules.wicket +
    p.catches       * rules.catch  +
    (p.runouts ?? 0) * rules.runout +
    (p.stumpings ?? 0) * rules.stump +
    p.fifty_bonus   * rules.fifty  +
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
