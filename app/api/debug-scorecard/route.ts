import { NextRequest, NextResponse } from "next/server";
import { refreshMatchFromProvider, type PlayerStats } from "@/lib/cricket-provider";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { type FantasyPlayer, playerPoints, scoringFromSettings } from "@/lib/scoring";

function providerStatsToFantasy(p: PlayerStats): FantasyPlayer {
  return {
    side: "You",
    name: p.name,
    captain: false,
    bench: false,
    runs: p.runs,
    wickets: p.wickets,
    catches: p.catches,
    runouts: p.runouts ?? 0,
    stumpings: p.stumpings ?? 0,
    fifty_bonus: p.fifty_bonus,
    hundred_bonus: p.hundred_bonus,
    three_w_bonus: p.three_w_bonus,
    five_w_bonus: p.five_w_bonus,
    mom_bonus: p.mom_bonus ?? 0,
    provider_player_id: p.id ?? null,
  };
}

/**
 * GET /api/debug-scorecard?id=<cricapi-uuid>
 * Runs the same provider pipeline as Sync scores (no DB writes). Use to see player rows * and metadata returned for a linked fixture.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing id query param (CricAPI external match UUID)." },
      { status: 400 }
    );
  }

  try {
    const [{ data: settings }, payload] = await Promise.all([
      supabaseAdmin.from("series_settings").select("*").limit(1).maybeSingle(),
      refreshMatchFromProvider(id),
    ]);
    const rules = scoringFromSettings(settings as Record<string, unknown> | null);

    const players = payload.players.map((p) => {
      const fp = providerStatsToFantasy(p);
      const asPick = playerPoints(fp, rules);
      const asCaptain = playerPoints({ ...fp, captain: true }, rules);
      return {
        id: p.id ?? null,
        name: p.name,
        runs: p.runs,
        wickets: p.wickets,
        catches: p.catches,
        runouts: p.runouts ?? 0,
        stumpings: p.stumpings ?? 0,
        fifty_bonus: p.fifty_bonus,
        hundred_bonus: p.hundred_bonus,
        three_w_bonus: p.three_w_bonus,
        five_w_bonus: p.five_w_bonus,
        mom_bonus: p.mom_bonus ?? 0,
        /** Points with your series rules (no captain ×2). */
        fantasyPts: asPick.base,
        /** Same stats if this player were your fantasy captain (×2 on base). */
        fantasyPtsAsCaptain: asCaptain.final,
      };
    });

    return NextResponse.json({
      ok: true,
      externalMatchId: id,
      fixture: payload.fixture ?? null,
      status: payload.status ?? null,
      match_date: payload.match_date ?? null,
      live_summary: payload.live_summary ?? null,
      venue: payload.venue ?? null,
      toss_winner: payload.toss_winner ?? null,
      scoringRules: rules,
      playerCount: players.length,
      players,
      rosterNameCount: payload.rosterNames.length,
      rosterSample: payload.rosterNames.slice(0, 24),
      squadTeamCount: payload.squads.length,
      manOfTheMatchSynced: payload.manOfTheMatchSynced ?? false,
      hint:
        players.length === 0
          ? "Zero player rows usually means match_scorecard / match_points failed or returned empty for this id — check CricAPI plan, quota, or id mismatch vs currentMatches."
          : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        externalMatchId: id,
        error: e instanceof Error ? e.message : "refreshMatchFromProvider failed",
      },
      { status: 500 }
    );
  }
}
