import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isLateMatchChangeContext, recordFantasyAuditEvent } from "@/lib/match-audit";

export async function POST(req: NextRequest) {
  try {
    const { playerId, runs, wickets, catches, runouts, stumpings, fifty_bonus, hundred_bonus, three_w_bonus, five_w_bonus, mom_bonus } = await req.json();

    if (!playerId) {
      return NextResponse.json({ ok: false, error: "playerId is required" }, { status: 400 });
    }

    const { data: row } = await supabaseAdmin
      .from("fantasy_players")
      .select(
        "id, match_id, side, name, competition_id, runs, wickets, catches, runouts, stumpings, fifty_bonus, hundred_bonus, three_w_bonus, five_w_bonus, mom_bonus"
      )
      .eq("id", playerId)
      .maybeSingle();

    if (!row) {
      return NextResponse.json({ ok: false, error: "Player row not found" }, { status: 404 });
    }

    const nextStats = {
      runs: Number(runs ?? 0),
      wickets: Number(wickets ?? 0),
      catches: Number(catches ?? 0),
      runouts: HNumber(runouts),
      stumpings: HNumber(stumpings),
      fifty_bonus: Number(fifty_bonus ?? 0),
      hundred_bonus: Number(hundred_bonus ?? 0),
      three_w_bonus: Number(three_w_bonus ?? 0),
      five_w_bonus: Number(five_w_bonus ?? 0),
      mom_bonus: Number(mom_bonus ?? 0),
    };

    const before = {
      runs: row.runs ?? 0,
      wickets: row.wickets ?? 0,
      catches: row.catches ?? 0,
      runouts: row.runouts ?? 0,
      stumpings: row.stumpings ?? 0,
      fifty_bonus: row.fifty_bonus ?? 0,
      hundred_bonus: row.hundred_bonus ?? 0,
      three_w_bonus: row.three_w_bonus ?? 0,
      five_w_bonus: row.five_w_bonus ?? 0,
      mom_bonus: row.mom_bonus ?? 0,
    };

    const statsEqual =
      before.runs === nextStats.runs &&
      before.wickets === nextStats.wickets &&
      before.catches === nextStats.catches &&
      before.runouts === nextStats.runouts &&
      before.stumpings === nextStats.stumpings &&
      before.fifty_bonus === nextStats.fifty_bonus &&
      before.hundred_bonus === nextStats.hundred_bonus &&
      before.three_w_bonus === nextStats.three_w_bonus &&
      before.five_w_bonus === nextStats.five_w_bonus &&
      before.mom_bonus === nextStats.mom_bonus;

    const { error } = await supabaseAdmin
      .from("fantasy_players")
      .update({
        runs: nextStats.runs,
        wickets: nextStats.wickets,
        catches: nextStats.catches,
        runouts: nextStats.runouts,
        stumpings: nextStats.stumpings,
        fifty_bonus: nextStats.fifty_bonus,
        hundred_bonus: nextStats.hundred_bonus,
        three_w_bonus: nextStats.three_w_bonus,
        five_w_bonus: nextStats.five_w_bonus,
        mom_bonus: nextStats.mom_bonus,
      })
      .eq("id", playerId);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    if (!statsEqual) {
      const { data: matchMeta } = await supabaseAdmin
        .from("matches")
        .select("match_date,status")
        .eq("id", row.match_id)
        .maybeSingle();
      const auditLate = isLateMatchChangeContext(
        matchMeta?.match_date as string | undefined,
        matchMeta?.status as string | undefined
      );
      if (auditLate) {
        const compId = row.competition_id != null && Number.isFinite(Number(row.competition_id)) ? Number(row.competition_id) : null;
        await recordFantasyAuditEvent({
          matchId: row.match_id,
          competitionId: compId,
          action: "manual_score",
          side: row.side ?? null,
          summary: `Manual scores — ${row.name}`,
          detail: {
            playerId: row.id,
            playerName: row.name,
            before,
            after: nextStats,
          },
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? "Unknown error" }, { status: 500 });
  }
}

function HNumber(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
