import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchMatchRoster } from "@/lib/cricket-provider";

export async function POST() {
  try {
    const { data: match, error } = await supabaseAdmin
      .from("matches")
      .select("id, external_match_id")
      .order("match_date", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .single();

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
        error: "Roster not available yet. The squad is usually published closer to match time.",
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
