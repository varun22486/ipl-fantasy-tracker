import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(req: NextRequest) {
  try {
    const { playerId, runs, wickets, catches, fifty_bonus, hundred_bonus, three_w_bonus, five_w_bonus, mom_bonus } = await req.json();

    if (!playerId) {
      return NextResponse.json({ ok: false, error: "playerId is required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("fantasy_players")
      .update({
        runs: Number(runs ?? 0),
        wickets: Number(wickets ?? 0),
        catches: Number(catches ?? 0),
        fifty_bonus: Number(fifty_bonus ?? 0),
        hundred_bonus: Number(hundred_bonus ?? 0),
        three_w_bonus: Number(three_w_bonus ?? 0),
        five_w_bonus: Number(five_w_bonus ?? 0),
        mom_bonus: Number(mom_bonus ?? 0),
      })
      .eq("id", playerId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}
