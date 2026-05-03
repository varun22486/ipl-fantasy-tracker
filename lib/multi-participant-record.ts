/**
 * Head-to-head(-to-head) fantasy: one match, N participants, one points total per name.
 * Outcome for each participant is win (sole high), tie (tied for high), or loss (strictly below high).
 */

export type MultiParticipantMatchStat = {
  hasData: boolean;
  pts: Record<string, number>;
};

export type MultiParticipantSeasonRow = {
  name: string;
  totalPoints: number;
  wins: number;
  losses: number;
  ties: number;
  /** Matches where this competition had any non-zero fantasy points (same for all participants). */
  matches: number;
};

export function outcomeForMultiParticipantMatch(
  m: MultiParticipantMatchStat,
  name: string,
  compPlayers: string[]
): "win" | "loss" | "tie" | "none" {
  if (!m.hasData) return "none";
  const maxPts = Math.max(...compPlayers.map((n) => m.pts[n] ?? 0), 0);
  if (maxPts <= 0) return "none";
  const myPts = m.pts[name] ?? 0;
  if (myPts < maxPts) return "loss";
  const leaders = compPlayers.filter((n) => (m.pts[n] ?? 0) === maxPts);
  if (leaders.length === 1) return "win";
  return "tie";
}

export function buildMultiParticipantSeasonRows(
  participantMatchStats: MultiParticipantMatchStat[],
  compPlayers: string[]
): MultiParticipantSeasonRow[] {
  return compPlayers
    .map((name) => {
      let wins = 0;
      let losses = 0;
      let ties = 0;
      let matches = 0;
      let totalPoints = 0;
      for (const m of participantMatchStats) {
        totalPoints += m.pts[name] ?? 0;
        if (!m.hasData) continue;
        matches += 1;
        const o = outcomeForMultiParticipantMatch(m, name, compPlayers);
        if (o === "win") wins += 1;
        else if (o === "loss") losses += 1;
        else if (o === "tie") ties += 1;
      }
      return { name, totalPoints, wins, losses, ties, matches };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints);
}
