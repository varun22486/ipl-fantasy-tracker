/**
 * On-time lineup bonus: anyone who was **not** late gets +P extra points for this match (per **competition**).
 * People marked late get no adjustment (no negative — they simply miss the bonus).
 *
 * Storage: `matches.lineup_lateness_by_comp` (JSON) keyed by `default` (series) or `competitionId`.
 * Legacy top-level `lineup_lateness_*` columns apply only to the default series when no `default` key exists.
 */
export const DEFAULT_LINEUP_LATENESS_POINTS = 250;

/** JSON object key for `competition_id is null` (main series) */
export const LINEUP_BONUS_DEFAULT_KEY = "default" as const;

export type MatchLineupLateness = {
  lineup_lateness_enabled?: boolean | null;
  /** Legacy single name; ignored if `lineup_late_participants` is non-empty. */
  lineup_late_participant?: string | null;
  lineup_late_participants?: string[] | null;
  lineup_lateness_points?: number | null;
};

export type MatchRowForLineupBonus = MatchLineupLateness & {
  /** Per-competition rules: { "default" | "123": { enabled, late, points } } */
  lineup_lateness_by_comp?: unknown;
};

function normName(s: string): string {
  return s.trim().toLowerCase();
}

function pointsValue(m: MatchLineupLateness): number {
  const P = m.lineup_lateness_points;
  if (typeof P === "number" && Number.isFinite(P) && P > 0) return Math.floor(P);
  return DEFAULT_LINEUP_LATENESS_POINTS;
}

export function compLineupStorageKey(competitionId: number | null): string {
  return competitionId == null ? LINEUP_BONUS_DEFAULT_KEY : String(Math.floor(competitionId));
}

function parseByCompEntry(raw: unknown): MatchLineupLateness | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled === true;
  let late: string[] | null = null;
  if (Array.isArray(o.late)) late = o.late.map((x) => String(x).trim()).filter(Boolean);
  else if (Array.isArray(o.lateParticipants)) late = o.lateParticipants.map((x) => String(x).trim()).filter(Boolean);
  const points =
    typeof o.points === "number" && Number.isFinite(o.points) && o.points > 0
      ? Math.floor(o.points)
      : DEFAULT_LINEUP_LATENESS_POINTS;
  if (!enabled) {
    return { lineup_lateness_enabled: false, lineup_lateness_points: points };
  }
  return {
    lineup_lateness_enabled: true,
    lineup_late_participants: late && late.length > 0 ? late : null,
    lineup_late_participant: late && late.length === 1 ? late[0]! : null,
    lineup_lateness_points: points,
  };
}

/**
 * Resolves the on-time bonus rule for this **competition** on a match row.
 * Named competitions never read the legacy **global** columns (fix: same fixture shared across comps).
 */
export function matchLineupForCompetition(
  row: MatchRowForLineupBonus | null | undefined,
  competitionId: number | null
): MatchLineupLateness {
  if (!row) return { lineup_lateness_enabled: false };
  const byComp = row.lineup_lateness_by_comp;
  const key = compLineupStorageKey(competitionId);
  if (byComp && typeof byComp === "object" && !Array.isArray(byComp)) {
    const blob = (byComp as Record<string, unknown>)[key];
    if (blob != null) {
      const parsed = parseByCompEntry(blob);
      if (parsed) return parsed;
    }
  }
  if (competitionId != null) {
    return { lineup_lateness_enabled: false, lineup_lateness_points: DEFAULT_LINEUP_LATENESS_POINTS };
  }
  // Default series: legacy columns if no "default" key in JSON
  return {
    lineup_lateness_enabled: row.lineup_lateness_enabled,
    lineup_late_participant: row.lineup_late_participant,
    lineup_late_participants: row.lineup_late_participants,
    lineup_lateness_points: row.lineup_lateness_points,
  };
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
