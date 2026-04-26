import { supabaseAdmin } from "@/lib/supabase-admin";
import { lateParticipantsList } from "@/lib/lineup-lateness";
import {
  MANUAL_SCORE_SNAPSHOT_COOLDOWN_MS,
  MATCH_SNAPSHOT_MAX_PER_MATCH,
  type MatchSnapshotSource,
} from "@/lib/match-snapshot-constants";

export {
  MANUAL_SCORE_SNAPSHOT_COOLDOWN_MS,
  MATCH_SNAPSHOT_MAX_PER_MATCH,
  type MatchSnapshotSource,
} from "@/lib/match-snapshot-constants";

export { SNAPSHOT_SOURCE_LABEL } from "@/lib/match-snapshot-constants";

const MATCH_SELECT =
  "id, status, live_summary, fantasy_voided, fixture, venue, toss_winner, source_url, last_synced_at, provider_squad_json, lineup_lateness_enabled, lineup_late_participant, lineup_late_participants, lineup_lateness_points, lineup_lateness_by_comp";

const PLAYER_SELECT =
  "match_id, side, name, captain, bench, runs, wickets, catches, runouts, stumpings, fifty_bonus, hundred_bonus, three_w_bonus, five_w_bonus, mom_bonus, provider_player_id, competition_id";

export type MatchSnapshotPayload = {
  match: {
    status: string | null;
    live_summary: string | null;
    fantasy_voided: boolean;
    fixture: string | null;
    venue: string | null;
    toss_winner: string | null;
    source_url: string | null;
    last_synced_at: string | null;
    provider_squad_json: unknown | null;
    lineup_lateness_enabled: boolean;
    lineup_late_participant: string | null;
    lineup_late_participants: string[] | null;
    lineup_lateness_points: number;
    lineup_lateness_by_comp: unknown | null;
  };
  players: Record<string, unknown>[];
};

export async function buildMatchSnapshotPayload(matchId: number): Promise<MatchSnapshotPayload> {
  const { data: match, error: mErr } = await supabaseAdmin.from("matches").select(MATCH_SELECT).eq("id", matchId).maybeSingle();
  if (mErr || !match) throw new Error("Match not found");

  const { data: players, error: pErr } = await supabaseAdmin
    .from("fantasy_players")
    .select(PLAYER_SELECT)
    .eq("match_id", matchId)
    .order("id", { ascending: true });

  if (pErr) throw new Error(pErr.message);

  const m = match as Record<string, unknown>;
  const lateResolved = lateParticipantsList({
    lineup_late_participant: m.lineup_late_participant as string | null,
    lineup_late_participants: m.lineup_late_participants as string[] | null,
  });
  return {
    match: {
      status: (m.status as string) ?? null,
      live_summary: (m.live_summary as string) ?? null,
      fantasy_voided: Boolean(m.fantasy_voided),
      fixture: (m.fixture as string) ?? null,
      venue: (m.venue as string) ?? null,
      toss_winner: (m.toss_winner as string) ?? null,
      source_url: (m.source_url as string) ?? null,
      last_synced_at: m.last_synced_at != null ? String(m.last_synced_at) : null,
      provider_squad_json: m.provider_squad_json ?? null,
      lineup_lateness_enabled: Boolean(m.lineup_lateness_enabled as boolean | undefined),
      lineup_late_participant: lateResolved.length === 1 ? lateResolved[0]! : null,
      lineup_late_participants: lateResolved.length > 0 ? lateResolved : null,
      lineup_lateness_points: Math.max(1, Math.floor(Number(m.lineup_lateness_points) || 250)),
      lineup_lateness_by_comp:
        m.lineup_lateness_by_comp && typeof m.lineup_lateness_by_comp === "object" && !Array.isArray(m.lineup_lateness_by_comp)
          ? m.lineup_lateness_by_comp
          : null,
    },
    players: (players ?? []) as Record<string, unknown>[],
  };
}

async function pruneOldMatchSnapshots(matchId: number) {
  const { data: stale } = await supabaseAdmin
    .from("match_state_snapshots")
    .select("id")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .range(MATCH_SNAPSHOT_MAX_PER_MATCH, 9999);

  if (!stale?.length) return;
  await supabaseAdmin.from("match_state_snapshots").delete().in(
    "id",
    stale.map((r) => r.id as number)
  );
}

export async function createMatchSnapshot(opts: {
  matchId: number;
  source: MatchSnapshotSource;
  summary?: string | null;
}): Promise<number | null> {
  try {
    const payload = await buildMatchSnapshotPayload(opts.matchId);
    const { data: inserted, error } = await supabaseAdmin
      .from("match_state_snapshots")
      .insert({
        match_id: opts.matchId,
        source: opts.source,
        summary: opts.summary?.trim() || null,
        payload,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[match_snapshot]", error.message);
      return null;
    }

    await pruneOldMatchSnapshots(opts.matchId);
    return inserted?.id as number;
  } catch (e) {
    console.error("[match_snapshot]", e);
    return null;
  }
}

export async function snapshotBeforeManualScoreIfDue(matchId: number): Promise<void> {
  const { data } = await supabaseAdmin
    .from("match_state_snapshots")
    .select("created_at")
    .eq("match_id", matchId)
    .eq("source", "pre_manual_score")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const last = data?.created_at ? new Date(String(data.created_at)).getTime() : 0;
  if (Date.now() - last < MANUAL_SCORE_SNAPSHOT_COOLDOWN_MS) return;

  await createMatchSnapshot({
    matchId,
    source: "pre_manual_score",
    summary: "Before manual score edit (auto)",
  });
}

export async function restoreMatchSnapshotById(
  snapshotId: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: snap, error: fErr } = await supabaseAdmin
    .from("match_state_snapshots")
    .select("id, match_id, payload")
    .eq("id", snapshotId)
    .maybeSingle();

  if (fErr || !snap) return { ok: false, error: "Snapshot not found" };

  const matchId = snap.match_id as number;
  const payload = snap.payload as MatchSnapshotPayload | null;
  if (!payload?.match || !Array.isArray(payload.players)) {
    return { ok: false, error: "Invalid snapshot payload" };
  }

  await createMatchSnapshot({
    matchId,
    source: "pre_restore",
    summary: `Before restoring snapshot #${snapshotId}`,
  });

  const { error: dErr } = await supabaseAdmin.from("fantasy_players").delete().eq("match_id", matchId);
  if (dErr) return { ok: false, error: dErr.message };

  if (payload.players.length > 0) {
    const { error: iErr } = await supabaseAdmin.from("fantasy_players").insert(payload.players);
    if (iErr) {
      return {
        ok: false,
        error: `${iErr.message} If your lineup is empty, restore the latest "Before restore" snapshot.`,
      };
    }
  }

  const m = payload.match as MatchSnapshotPayload["match"] & Record<string, unknown>;
  const legacyParticipant = m.lineup_late_participant as string | null | undefined;
  const fromPayloadArr = m.lineup_late_participants;
  const lateArr =
    Array.isArray(fromPayloadArr) && fromPayloadArr.length > 0
      ? (fromPayloadArr as string[]).map((s) => String(s).trim()).filter(Boolean)
      : legacyParticipant?.trim()
        ? [legacyParticipant.trim()]
        : null;
  const { error: uErr } = await supabaseAdmin
    .from("matches")
    .update({
      status: m.status ?? "DRAFT",
      live_summary: m.live_summary,
      fantasy_voided: m.fantasy_voided,
      fixture: m.fixture ?? "",
      venue: m.venue,
      toss_winner: m.toss_winner,
      source_url: m.source_url,
      last_synced_at: m.last_synced_at,
      provider_squad_json: m.provider_squad_json,
      lineup_lateness_enabled: m.lineup_lateness_enabled === true,
      lineup_late_participant: lateArr && lateArr.length === 1 ? lateArr[0]! : null,
      lineup_late_participants: lateArr,
      lineup_lateness_points: Math.max(1, Math.floor(Number(m.lineup_lateness_points) || 250)),
      lineup_lateness_by_comp:
        m.lineup_lateness_by_comp !== undefined && m.lineup_lateness_by_comp !== null
          ? m.lineup_lateness_by_comp
          : ({} as Record<string, unknown>),
    })
    .eq("id", matchId);

  if (uErr) return { ok: false, error: uErr.message };

  return { ok: true };
}
