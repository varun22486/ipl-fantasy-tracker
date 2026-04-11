import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchMatchRoster, type MatchSeed } from "@/lib/cricket-provider";
import { parseStoredProviderSquad } from "@/lib/provider-squad-json";

async function attachMatchRoster(
  matchId: number,
  externalMatchId: string | undefined,
  existingSquadJson?: unknown
) {
  if (!externalMatchId) return;
  const cached = parseStoredProviderSquad(existingSquadJson ?? null);
  if (cached && cached.rosterNames.length > 0) return;
  try {
    const { squads, rosterNames, nameToId } = await fetchMatchRoster(externalMatchId);
    await supabaseAdmin
      .from("matches")
      .update({ provider_squad_json: { squads, rosterNames, nameToId } })
      .eq("id", matchId);
  } catch {
    // Roster is optional until the first successful score sync.
  }
}

export type PersistSeededMatchOptions = {
  /** When false, skip provider roster fetch (saves API credits). Default true. */
  attachRoster?: boolean;
};

/** Upsert a linked IPL row and mark it tracked (`is_current`). Shared by POST /api/seed and cron auto-link. */
export async function persistSeededMatch(
  discovered: MatchSeed,
  options?: PersistSeededMatchOptions
): Promise<Record<string, unknown>> {
  const { data: existingByExternal } = await supabaseAdmin
    .from("matches")
    .select("*")
    .eq("external_match_id", discovered.externalMatchId)
    .maybeSingle();

  let match: Record<string, unknown>;

  if (existingByExternal) {
    const { data: updated, error } = await supabaseAdmin
      .from("matches")
      .update({
        fixture: discovered.fixture,
        venue: discovered.venue,
        toss_winner: discovered.toss_winner,
        status: discovered.status,
        live_summary: discovered.live_summary,
        source_url: discovered.source_url,
        match_date: discovered.match_date,
        label: discovered.label,
      })
      .eq("id", existingByExternal.id)
      .select("*")
      .single();

    if (error) throw error;
    match = updated as Record<string, unknown>;
  } else {
    const { data: existingByLabel } = await supabaseAdmin
      .from("matches")
      .select("*")
      .eq("label", discovered.label)
      .maybeSingle();

    if (existingByLabel) {
      const { data: updated, error } = await supabaseAdmin
        .from("matches")
        .update({
          external_match_id: discovered.externalMatchId,
          fixture: discovered.fixture,
          venue: discovered.venue,
          toss_winner: discovered.toss_winner,
          status: discovered.status,
          live_summary: discovered.live_summary,
          source_url: discovered.source_url,
          auto_sync: true,
          match_date: discovered.match_date,
        })
        .eq("id", existingByLabel.id)
        .select("*")
        .single();

      if (error) throw error;
      match = updated as Record<string, unknown>;
    } else {
      const { data: inserted, error } = await supabaseAdmin
        .from("matches")
        .insert({
          external_match_id: discovered.externalMatchId,
          match_date: discovered.match_date,
          label: discovered.label,
          fixture: discovered.fixture,
          venue: discovered.venue,
          toss_winner: discovered.toss_winner,
          status: discovered.status,
          live_summary: discovered.live_summary,
          source_url: discovered.source_url,
          auto_sync: true,
        })
        .select("*")
        .single();

      if (error) throw error;
      match = inserted as Record<string, unknown>;
    }
  }

  const mid = Number(match.id);
  const { error: clearErr } = await supabaseAdmin.from("matches").update({ is_current: false }).neq("id", mid);
  if (clearErr) {
    console.error("is_current clear failed:", clearErr.message);
  }
  const { error: setErr } = await supabaseAdmin.from("matches").update({ is_current: true }).eq("id", mid);
  if (setErr) {
    console.error("is_current update failed — run: ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;");
  }

  if (options?.attachRoster !== false) {
    await attachMatchRoster(Number(match.id), discovered.externalMatchId, match.provider_squad_json);
  }
  return match;
}
