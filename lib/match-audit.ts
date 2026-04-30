import { supabaseAdmin } from "@/lib/supabase-admin";

/** Grace period after nominal first ball before lineup / manual edits are treated as “late” and logged. */
export const LATE_CHANGE_GRACE_MS = 5 * 60 * 1000;

/**
 * Nominal IPL evening start: 7:30 PM IST on `match_date` → 14:00 UTC.
 * (DB only stores `match_date`; used together with status for “match under way”.)
 */
export function nominalMatchStartUtcMs(matchDateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(matchDateStr).trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  return Date.UTC(y, mo - 1, d, 14, 0, 0);
}

/** True when the fixture is clearly live/finished, or local time is past nominal start + grace. */
export function isLateMatchChangeContext(
  matchDate: string | null | undefined,
  status: string | null | undefined
): boolean {
  const s = (status ?? "").trim();
  if (s) {
    if (/\bLIVE\b/i.test(s)) return true;
    if (/\b(COMPLETED|ABANDONED)\b/i.test(s)) return true;
    if (/\bINNINGS\b/i.test(s)) return true;
    if (/won by|won the match|\bbeat\b|defeat|match ended|no result|super over|stumps/i.test(s)) return true;
  }
  const t0 = matchDate ? nominalMatchStartUtcMs(matchDate) : null;
  if (t0 == null || !Number.isFinite(t0)) return false;
  return Date.now() > t0 + LATE_CHANGE_GRACE_MS;
}

export type AuditAction = "lineup_change" | "manual_score" | "cricbuzz_scorecard";

export async function recordFantasyAuditEvent(opts: {
  matchId: number;
  competitionId: number | null;
  action: AuditAction;
  side: string | null;
  summary: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("fantasy_audit_events").insert({
      match_id: opts.matchId,
      competition_id: opts.competitionId,
      action: opts.action,
      side: opts.side,
      summary: opts.summary,
      detail: opts.detail,
    });
    if (error) console.error("[fantasy_audit]", error.message);
  } catch (e) {
    console.error("[fantasy_audit]", e);
  }
}

type LineupSnap = { name: string; captain: boolean; bench: boolean };

export function lineupSnapshotsEqual(a: LineupSnap[], b: LineupSnap[]): boolean {
  const norm = (rows: LineupSnap[]) =>
    [...rows]
      .map((r) => `${r.name.toLowerCase()}|${r.captain ? 1 : 0}|${r.bench ? 1 : 0}`)
      .sort()
      .join(";");
  return norm(a) === norm(b);
}
