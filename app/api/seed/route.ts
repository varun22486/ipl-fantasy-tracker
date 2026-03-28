import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  fetchMatchRoster,
  getBestLeagueMatch,
  getMatchSeedByExternalIdForToday,
  type MatchSeed,
} from "@/lib/cricket-provider";

async function attachMatchRoster(matchId: number, externalMatchId: string | undefined) {
  if (!externalMatchId) return;
  try {
    const { squads, rosterNames } = await fetchMatchRoster(externalMatchId);
    await supabaseAdmin
      .from("matches")
      .update({ provider_squad_json: { squads, rosterNames } })
      .eq("id", matchId);
  } catch {
    // Roster is optional until the first successful score sync.
  }
}

async function persistSeededMatch(discovered: MatchSeed) {
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

  await attachMatchRoster(Number(match.id), discovered.externalMatchId);
  return match;
}

async function seedMatchAuto() {
  const discovered = await getBestLeagueMatch();
  return persistSeededMatch(discovered);
}

export async function GET() {
  try {
    const match = await seedMatchAuto();
    return NextResponse.json({ ok: true, match });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Seed failed",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    let externalMatchId = "";
    try {
      const body = await req.json();
      externalMatchId = typeof body?.externalMatchId === "string" ? body.externalMatchId.trim() : "";
    } catch {
      // no JSON body — fall through to auto seed
    }

    if (externalMatchId) {
      const discovered = await getMatchSeedByExternalIdForToday(externalMatchId);
      if (!discovered) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Could not find that fixture via the API. The match may be too old for the live feed — try refreshing the list or check your API quota.",
          },
          { status: 400 }
        );
      }
      const match = await persistSeededMatch(discovered);
      return NextResponse.json({ ok: true, match });
    }

    const match = await seedMatchAuto();
    return NextResponse.json({ ok: true, match });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Seed failed",
      },
      { status: 500 }
    );
  }
}
