import { supabaseAdmin } from "@/lib/supabase-admin";

/** Oldest snapshots are deleted per match after this many rows. */
export const MATCH_SNAPSHOT_MAX_PER_MATCH = 40;

/** At most one auto snapshot per match this often during rapid ✏️ edits. */
export const MANUAL_SCORE_SNAPSHOT_COOLDOWN_MS = 90_000;

export type MatchSnapshotSource =
  | "pre_void"
  | "pre_unvoid"
  | "pre_sync"
  | "pre_lineup"
  | "pre_manual_score"
  | "pre_restore"
  | "user_checkpoint";

const MATCH_SELECT =
  "id, status, live_summary, fantasy_voided, fixture, venue, toss_winner, source_url, last_synced_at, provider_squad_json";

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
  };
  players: Record<string, unknown>[];
};

export const SNAPSHOT_SOURCE_LABEL: Record<MatchSnapshotSource, string> = {
  pre_void: "Before void",
  pre_unvoid: "Before remove void",
  pre_sync: "Before sync",
  pre_lineup: "Before lineup save",
  pre_manual_score: "Before manual edit",
  pre_restore: "Before restore",
  user_checkpoint: "Saved checkpoint",
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

  const m = payload.match;
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
    })
    .eq("id", matchId);

  if (uErr) return { ok: false, error: uErr.message };

  return { ok: true };
}
