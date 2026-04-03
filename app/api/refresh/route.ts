import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { refreshMatchFromProvider } from "@/lib/cricket-provider";

type SelectedPlayer = {
  id: number;
  name: string;
  side: "You" | "Rahul";
  provider_player_id?: string | null;
};

function normalizeName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function collapsedName(name: string) {
  return normalizeName(name).replace(/\s+/g, "");
}

function tokens(name: string) {
  return normalizeName(name).split(/\s+/).filter(Boolean);
}

function buildVariants(name: string) {
  const normalized = normalizeName(name);
  const tokenList = tokens(name);
  const variants = new Set<string>();

  if (normalized) variants.add(normalized);
  const collapsed = collapsedName(name);
  if (collapsed) variants.add(collapsed);

  if (tokenList.length >= 2) {
    const first = tokenList[0];
    const last = tokenList[tokenList.length - 1];
    variants.add(`${first} ${last}`);
    variants.add(`${first[0]} ${last}`);
    variants.add(`${first[0]}${last}`);
    variants.add(last);
  }

  return Array.from(variants).filter(Boolean);
}

function findIncomingPlayer(
  playerName: string,
  incomingByVariant: Map<
    string,
    {
      name: string;
      runs: number;
      wickets: number;
      catches: number;
      runouts: number;
      stumpings: number;
      fifty_bonus: number;
      hundred_bonus: number;
      three_w_bonus: number;
      five_w_bonus: number;
      mom_bonus?: number;
    }
  >
) {
  for (const variant of buildVariants(playerName)) {
    const hit = incomingByVariant.get(variant);
    if (hit) return hit;
  }
  return null;
}

function summarizeNames(names: string[], limit = 12) {
  return names.slice(0, limit);
}

async function doRefresh(matchId?: number) {
  // If a specific matchId is provided, load that match directly
  let currentMatch: any = null;
  if (matchId) {
    ({ data: currentMatch } = await supabaseAdmin.from("matches").select("*").eq("id", matchId).single());
  }
  // Otherwise fall back to the "current" match
  if (!currentMatch) {
    ({ data: currentMatch } = await supabaseAdmin.from("matches").select("*").eq("is_current", true).limit(1).maybeSingle());
  }
  if (!currentMatch) {
    ({ data: currentMatch } = await supabaseAdmin.from("matches").select("*").order("id", { ascending: false }).limit(1).maybeSingle());
  }

  return currentMatch;
}

export async function GET() {
  try {
    const currentMatch = await doRefresh();

    if (!currentMatch?.external_match_id) {
      return NextResponse.json({ ok: false, error: "No seeded match with an external match id yet." }, { status: 400 });
    }

    const { data: selectedPlayers } = await supabaseAdmin
      .from("fantasy_players")
      .select("id,name,side,provider_player_id")
      .eq("match_id", currentMatch.id)
      .order("id", { ascending: true });

    const selected = (selectedPlayers ?? []) as SelectedPlayer[];
    const lastSyncedAt = currentMatch.last_synced_at ? new Date(currentMatch.last_synced_at).getTime() : 0;
    const now = Date.now();
    const minIntervalMs = 25_000;

    if (lastSyncedAt && now - lastSyncedAt < minIntervalMs) {
      const secondsUntilNext = Math.max(1, Math.ceil((minIntervalMs - (now - lastSyncedAt)) / 1000));
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `Using cached data. Try again in ${secondsUntilNext}s.`,
        debug: {
          matchId: currentMatch.id,
          externalMatchId: currentMatch.external_match_id,
          selectedPlayers: selected.map((p) => p.name),
          selectedCount: selected.length,
          lastSyncedAt: currentMatch.last_synced_at,
          liveSummary: currentMatch.live_summary,
        },
      });
    }

    const payload = await refreshMatchFromProvider(String(currentMatch.external_match_id));

    // Build two lookups: by provider player ID (authoritative) and by name variants (fallback)
    const incomingById      = new Map<string, (typeof payload.players)[number]>();
    const incomingByVariant = new Map<string, (typeof payload.players)[number]>();
    for (const player of payload.players) {
      if (player.id) incomingById.set(player.id, player);
      for (const variant of buildVariants(player.name)) {
        if (!incomingByVariant.has(variant)) incomingByVariant.set(variant, player);
      }
    }

    const matched: Array<{ selected: string; provider: string; matchedById: boolean }> = [];
    const unmatched: string[] = [];
    let updatedRows = 0;

    for (const player of selected) {
      // Prefer ID match (no name ambiguity)
      const idHit = player.provider_player_id ? incomingById.get(player.provider_player_id) : null;
      const hit = idHit ?? findIncomingPlayer(player.name, incomingByVariant);
      if (!hit) {
        unmatched.push(player.name);
        continue;
      }

      matched.push({ selected: player.name, provider: hit.name, matchedById: Boolean(idHit) });

      // Write stats + lazily capture provider_player_id for future ID-based matching
      const updatePayload: Record<string, unknown> = {
        runs: hit.runs,
        wickets: hit.wickets,
        catches: hit.catches,
        runouts: hit.runouts ?? 0,
        stumpings: hit.stumpings ?? 0,
        fifty_bonus: hit.fifty_bonus,
        hundred_bonus: hit.hundred_bonus,
        three_w_bonus: hit.three_w_bonus,
        five_w_bonus: hit.five_w_bonus,
      };
      if (payload.manOfTheMatchSynced) {
        updatePayload.mom_bonus = hit.mom_bonus ?? 0;
      }
      if (!player.provider_player_id && hit.id) {
        updatePayload.provider_player_id = hit.id;
      }

      await supabaseAdmin
        .from("fantasy_players")
        .update(updatePayload)
        .eq("id", player.id);

      updatedRows += 1;
    }

    const syncedAt = new Date().toISOString();

    await supabaseAdmin
      .from("matches")
      .update({
        status: payload.status || currentMatch.status,
        fixture: payload.fixture || currentMatch.fixture,
        ...(payload.match_date ? { match_date: payload.match_date } : {}),
        venue: payload.venue ?? currentMatch.venue,
        toss_winner: payload.toss_winner ?? currentMatch.toss_winner,
        live_summary: payload.live_summary ?? currentMatch.live_summary,
        source_url: payload.source_url ?? currentMatch.source_url,
        last_synced_at: syncedAt,
        // Only overwrite squad data if we actually got something from the scorecard
        ...(payload.rosterNames.length > 0
          ? { provider_squad_json: { squads: payload.squads, rosterNames: payload.rosterNames } }
          : {}),
      })
      .eq("id", currentMatch.id);

    const providerNames = payload.players.map((p) => p.name).filter(Boolean);

    return NextResponse.json({
      ok: true,
      skipped: false,
      message:
        payload.players.length === 0
          ? (payload.live_summary || "Scorecard not available from API — stats unchanged.")
          : updatedRows > 0
          ? `Updated ${updatedRows} of ${selected.length} selected players.`
          : "Names in lineup didn't match the scorecard — check debug panel.",
      live_summary: payload.live_summary,
      debug: {
        matchId: currentMatch.id,
        externalMatchId: currentMatch.external_match_id,
        selectedCount: selected.length,
        providerRowCount: payload.players.length,
        updatedRows,
        matched,
        unmatched,
        providerPlayersSample: summarizeNames(providerNames),
        rosterCount: payload.rosterNames.length,
        fixture: payload.fixture || currentMatch.fixture,
        status: payload.status || currentMatch.status,
        syncedAt,
        sourceUrl: payload.source_url ?? currentMatch.source_url,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Refresh failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    let matchId: number | undefined;
    try {
      const body = await req.json();
      if (body?.matchId) matchId = Number(body.matchId);
    } catch { /* no body or not JSON — that's fine */ }

    const currentMatch = await doRefresh(matchId);

    if (!currentMatch?.external_match_id) {
      return NextResponse.json({ ok: false, error: "No match with an external ID found." }, { status: 400 });
    }

    const { data: selectedPlayers } = await supabaseAdmin
      .from("fantasy_players").select("id,name,side,provider_player_id").eq("match_id", currentMatch.id).order("id", { ascending: true });

    const selected = (selectedPlayers ?? []) as SelectedPlayer[];
    const lastSyncedAt = currentMatch.last_synced_at ? new Date(currentMatch.last_synced_at).getTime() : 0;
    const now = Date.now();
    const minIntervalMs = 25_000;

    if (lastSyncedAt && now - lastSyncedAt < minIntervalMs) {
      const secondsUntilNext = Math.max(1, Math.ceil((minIntervalMs - (now - lastSyncedAt)) / 1000));
      return NextResponse.json({ ok: true, skipped: true, reason: `Using cached data. Try again in ${secondsUntilNext}s.` });
    }

    const payload = await refreshMatchFromProvider(String(currentMatch.external_match_id));

    const incomingById      = new Map<string, (typeof payload.players)[number]>();
    const incomingByVariant = new Map<string, (typeof payload.players)[number]>();
    for (const player of payload.players) {
      if (player.id) incomingById.set(player.id, player);
      for (const variant of buildVariants(player.name)) {
        if (!incomingByVariant.has(variant)) incomingByVariant.set(variant, player);
      }
    }

    const matched: Array<{ selected: string; provider: string; matchedById: boolean }> = [];
    const unmatched: string[] = [];
    let updatedRows = 0;

    for (const player of selected) {
      const idHit = player.provider_player_id ? incomingById.get(player.provider_player_id) : null;
      const hit = idHit ?? findIncomingPlayer(player.name, incomingByVariant);
      if (!hit) { unmatched.push(player.name); continue; }
      matched.push({ selected: player.name, provider: hit.name, matchedById: Boolean(idHit) });
      const updatePayload: Record<string, unknown> = {
        runs: hit.runs,
        wickets: hit.wickets,
        catches: hit.catches,
        runouts: hit.runouts ?? 0,
        stumpings: hit.stumpings ?? 0,
        fifty_bonus: hit.fifty_bonus,
        hundred_bonus: hit.hundred_bonus,
        three_w_bonus: hit.three_w_bonus,
        five_w_bonus: hit.five_w_bonus,
      };
      if (payload.manOfTheMatchSynced) {
        updatePayload.mom_bonus = hit.mom_bonus ?? 0;
      }
      if (!player.provider_player_id && hit.id) updatePayload.provider_player_id = hit.id;
      await supabaseAdmin.from("fantasy_players").update(updatePayload).eq("id", player.id);
      updatedRows += 1;
    }

    const syncedAt = new Date().toISOString();
    await supabaseAdmin.from("matches").update({
      status: payload.status || currentMatch.status,
      fixture: payload.fixture || currentMatch.fixture,
      ...(payload.match_date ? { match_date: payload.match_date } : {}),
      venue: payload.venue ?? currentMatch.venue,
      toss_winner: payload.toss_winner ?? currentMatch.toss_winner,
      live_summary: payload.live_summary ?? currentMatch.live_summary,
      source_url: payload.source_url ?? currentMatch.source_url,
      last_synced_at: syncedAt,
      ...(payload.rosterNames.length > 0 ? { provider_squad_json: { squads: payload.squads, rosterNames: payload.rosterNames } } : {}),
    }).eq("id", currentMatch.id);

    return NextResponse.json({
      ok: true, skipped: false,
      message: payload.players.length === 0
        ? (payload.live_summary || "Scorecard not available from API — stats unchanged.")
        : updatedRows > 0
          ? `Updated ${updatedRows} of ${selected.length} players.`
          : "Names in lineup didn't match the scorecard — check spelling.",
      live_summary: payload.live_summary,
      debug: { matchId: currentMatch.id, selectedCount: selected.length, updatedRows, matched, unmatched, providerPlayersSample: summarizeNames(payload.players.map(p => p.name)), syncedAt },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Refresh failed" }, { status: 500 });
  }
}
