import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { VOIDED_MATCH_FANTASY_SCORES } from "@/lib/match-void";
import { createMatchSnapshot } from "@/lib/match-snapshot";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const matchId = Number(body?.matchId);
    const voided = Boolean(body?.void);
    if (!Number.isFinite(matchId) || matchId < 1) {
      return NextResponse.json({ ok: false, error: "Invalid matchId" }, { status: 400 });
    }

    const { data: row, error: fetchErr } = await supabaseAdmin.from("matches").select("id").eq("id", matchId).maybeSingle();
    if (fetchErr || !row) {
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    await createMatchSnapshot({
      matchId,
      source: voided ? "pre_void" : "pre_unvoid",
      summary: voided ? "Before void (scores will be cleared)" : "Before remove void",
    });

    const { error: upErr } = await supabaseAdmin.from("matches").update({ fantasy_voided: voided }).eq("id", matchId);
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    if (voided) {
      const { error: zErr } = await supabaseAdmin.from("fantasy_players").update(VOIDED_MATCH_FANTASY_SCORES).eq("match_id", matchId);
      if (zErr) {
        return NextResponse.json({ ok: false, error: zErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      void: voided,
      message: voided
        ? "Match voided — all fantasy scores zeroed; excluded from standings and stats."
        : "Void removed — this match counts again. Re-sync or edit scores to repopulate stats.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
