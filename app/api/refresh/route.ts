import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { refreshMatchFromProvider } from "@/lib/cricket-provider";

type SelectedPlayer = {
  id: number;
  name: string;
  side: "You" | "Rahul";
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
  incomingByVariant: Map<string, { name: string; runs: number; wickets: number; catches: number; fifty_bonus: number; hundred_bonus: number; three_w_bonus: number; five_w_bonus: number }>
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

export async function GET() {
  try {
    // Mirror page.tsx: prefer is_current flag, fall back to most recently inserted
    let { data: currentMatch } = await supabaseAdmin
      .from("matches")
      .select("*")
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();
    if (!currentMatch) {
      ({ data: currentMatch } = await supabaseAdmin
        .from("matches")
        .select("*")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (!currentMatch?.external_match_id) {
      return NextResponse.json({ ok: false, error: "No seeded match with an external match id yet." }, { status: 400 });
    }

    const { data: selectedPlayers } = await supabaseAdmin
      .from("fantasy_players")
      .select("id,name,side,trump,runs,wickets,catches")
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

    const incomingByVariant = new Map<string, (typeof payload.players)[number]>();
    for (const player of payload.players) {
      for (const variant of buildVariants(player.name)) {
        if (!incomingByVariant.has(variant)) {
          incomingByVariant.set(variant, player);
        }
      }
    }

    const matched: Array<{ selected: string; provider: string }> = [];
    const unmatched: string[] = [];
    let updatedRows = 0;

    for (const player of selected) {
      const hit = findIncomingPlayer(player.name, incomingByVariant);
      if (!hit) {
        unmatched.push(player.name);
        continue;
      }

      matched.push({ selected: player.name, provider: hit.name });

      await supabaseAdmin
        .from("fantasy_players")
        .update({
          runs: hit.runs,
          wickets: hit.wickets,
          catches: hit.catches,
          fifty_bonus: hit.fifty_bonus,
          hundred_bonus: hit.hundred_bonus,
          three_w_bonus: hit.three_w_bonus,
          five_w_bonus: hit.five_w_bonus,
        })
        .eq("id", player.id);

      updatedRows += 1;
    }

    const syncedAt = new Date().toISOString();

    await supabaseAdmin
      .from("matches")
      .update({
        status: payload.status || currentMatch.status,
        fixture: payload.fixture || currentMatch.fixture,
        venue: payload.venue ?? currentMatch.venue,
        toss_winner: payload.toss_winner ?? currentMatch.toss_winner,
        live_summary: payload.live_summary ?? currentMatch.live_summary,
        source_url: payload.source_url ?? currentMatch.source_url,
        last_synced_at: syncedAt,
        provider_squad_json: { squads: payload.squads, rosterNames: payload.rosterNames },
      })
      .eq("id", currentMatch.id);

    const providerNames = payload.players.map((p) => p.name).filter(Boolean);

    return NextResponse.json({
      ok: true,
      skipped: false,
      message:
        updatedRows > 0
          ? `Updated ${updatedRows} of ${selected.length} selected players.`
          : "No selected player names matched the provider payload.",
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

export async function POST() {
  return GET();
}
