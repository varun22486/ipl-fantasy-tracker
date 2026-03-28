import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const { matchId, status, players } = await req.json();

    if (!matchId) {
      return NextResponse.json({ error: "matchId is required" }, { status: 400 });
    }

    if (status) {
      await supabaseAdmin
        .from("matches")
        .update({ status })
        .eq("id", matchId);
    }

    if (Array.isArray(players)) {
      for (const p of players) {
        await supabaseAdmin
          .from("fantasy_players")
          .update({
            runs: p.runs ?? 0,
            wickets: p.wickets ?? 0,
            catches: p.catches ?? 0,
            fifty_bonus: p.fifty_bonus ?? 0,
            hundred_bonus: p.hundred_bonus ?? 0,
            three_w_bonus: p.three_w_bonus ?? 0,
            five_w_bonus: p.five_w_bonus ?? 0,
            mom_bonus: p.mom_bonus ?? 0,
            trump: !!p.trump,
          })
          .eq("id", p.id);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Failed to update match" }, { status: 500 });
  }
}
