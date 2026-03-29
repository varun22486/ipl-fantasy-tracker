import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchMatchRoster } from "@/lib/cricket-provider";

export async function POST() {
  try {
    // Mirror page.tsx: prefer is_current flag, fall back to most recently inserted
    let { data: match, error } = await supabaseAdmin
      .from("matches")
      .select("id, external_match_id")
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();
    if (!match) {
      ({ data: match, error } = await supabaseAdmin
        .from("matches")
        .select("id, external_match_id")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle());
    }

    if (error || !match) {
      return NextResponse.json({ ok: false, error: "No linked match found." }, { status: 400 });
    }

    const extId = match.external_match_id as string | null;
    if (!extId) {
      return NextResponse.json({ ok: false, error: "Match has no external ID — cannot fetch roster." }, { status: 400 });
    }

    const { squads, rosterNames } = await fetchMatchRoster(extId);

    if (rosterNames.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `No player data returned by the API for match ${extId}. Try the debug endpoint: /api/debug-roster?id=${extId}`,
      }, { status: 404 });
    }

    await supabaseAdmin
      .from("matches")
      .update({ provider_squad_json: { squads, rosterNames } })
      .eq("id", match.id);

    return NextResponse.json({ ok: true, playerCount: rosterNames.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch roster";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
