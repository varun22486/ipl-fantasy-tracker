/**
 * Late lineup bonus: anyone who was **not** late gets +P extra points for this match.
 * People marked late get no adjustment (no negative — they simply miss the bonus).
 */
export const DEFAULT_LINEUP_LATENESS_POINTS = 250;

export type MatchLineupLateness = {
  lineup_lateness_enabled?: boolean | null;
  /** Legacy single name; ignored if `lineup_late_participants` is non-empty. */
  lineup_late_participant?: string | null;
  lineup_late_participants?: string[] | null;
  lineup_lateness_points?: number | null;
};

function normName(s: string): string {
  return s.trim().toLowerCase();
}

function pointsValue(m: MatchLineupLateness): number {
  const P = m.lineup_lateness_points;
  if (typeof P === "number" && Number.isFinite(P) && P > 0) return Math.floor(P);
  return DEFAULT_LINEUP_LATENESS_POINTS;
}

/** Normalized list of late participant display names (deduped). */
export function lateParticipantsList(m: MatchLineupLateness): string[] {
  const fromArr = m.lineup_late_participants;
  if (Array.isArray(fromArr) && fromArr.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of fromArr) {
      const s = String(x ?? "").trim();
      if (!s) continue;
      const k = normName(s);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
    return out;
  }
  const one = String(m.lineup_late_participant ?? "").trim();
  return one ? [one] : [];
}

/**
 * @param allParticipantNames — every fantasy participant in this competition (e.g. ["You","Rahul"] or comp.players).
 * @returns 0 if voided, disabled, not applicable, or this person was late; +pts if they were on time.
 */
export function lineupLatenessSideAdjustment(
  m: MatchLineupLateness,
  participantName: string,
  opts: { voided: boolean; allParticipantNames: string[] }
): number {
  if (opts.voided) return 0;
  if (!m.lineup_lateness_enabled) return 0;
  const lateList = lateParticipantsList(m);
  if (lateList.length === 0) return 0;
  const pts = pointsValue(m);
  const me = normName(participantName);
  if (!opts.allParticipantNames.some((n) => normName(n) === me)) return 0;
  const lateNorm = new Set(lateList.map((n) => normName(n)));
  if (lateNorm.has(me)) return 0;
  return +pts;
}

export function hasLineupLatenessActive(m: MatchLineupLateness, voided: boolean): boolean {
  if (voided) return false;
  return Boolean(m.lineup_lateness_enabled && lateParticipantsList(m).length > 0);
}
