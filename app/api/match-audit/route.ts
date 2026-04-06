import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(req: NextRequest) {
  const matchIdRaw = req.nextUrl.searchParams.get("matchId");
  const matchId = matchIdRaw != null ? parseInt(matchIdRaw, 10) : NaN;
  if (!Number.isFinite(matchId) || matchId <= 0) {
    return NextResponse.json({ ok: false, error: "matchId required" }, { status: 400 });
  }

  const cParam = req.nextUrl.searchParams.get("c");
  const competitionId =
    cParam != null && cParam !== "" && !Number.isNaN(Number(cParam)) ? Number(cParam) : null;

  let q = supabaseAdmin
    .from("fantasy_audit_events")
    .select("id, action, side, summary, detail, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (competitionId != null) q = q.eq("competition_id", competitionId);
  else q = q.is("competition_id", null);

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, events: data ?? [] });
}
