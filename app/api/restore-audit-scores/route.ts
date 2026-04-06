import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type BeforeStats = {
  runs?: unknown;
  wickets?: unknown;
  catches?: unknown;
  runouts?: unknown;
  stumpings?: unknown;
  fifty_bonus?: unknown;
  hundred_bonus?: unknown;
  three_w_bonus?: unknown;
  five_w_bonus?: unknown;
  mom_bonus?: unknown;
};

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Re-apply `detail.before` from a fantasy_audit_events row (manual_score only).
 * Only helps when that audit entry exists — void/sync do not create these rows.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auditEventId = Number(body?.auditEventId);
    if (!Number.isFinite(auditEventId) || auditEventId < 1) {
      return NextResponse.json({ ok: false, error: "auditEventId required" }, { status: 400 });
    }

    const { data: ev, error: fetchErr } = await supabaseAdmin
      .from("fantasy_audit_events")
      .select("id, match_id, action, detail")
      .eq("id", auditEventId)
      .maybeSingle();

    if (fetchErr || !ev) {
      return NextResponse.json({ ok: false, error: "Audit event not found" }, { status: 404 });
    }

    if (ev.action !== "manual_score") {
      return NextResponse.json(
        { ok: false, error: "Only manual_score audit rows can restore player stats." },
        { status: 400 }
      );
    }

    const detail = ev.detail as Record<string, unknown> | null;
    const playerId = Number(detail?.playerId);
    const before = detail?.before as BeforeStats | null | undefined;
    if (!Number.isFinite(playerId) || playerId < 1 || !before || typeof before !== "object") {
      return NextResponse.json(
        { ok: false, error: "This audit entry has no restorable before snapshot." },
        { status: 400 }
      );
    }

    const { data: row } = await supabaseAdmin
      .from("fantasy_players")
      .select("id, match_id")
      .eq("id", playerId)
      .maybeSingle();

    if (!row || Number(row.match_id) !== Number(ev.match_id)) {
      return NextResponse.json(
        { ok: false, error: "Player row missing or does not belong to this match." },
        { status: 404 }
      );
    }

    const payload = {
      runs: n(before.runs),
      wickets: n(before.wickets),
      catches: n(before.catches),
      runouts: n(before.runouts),
      stumpings: n(before.stumpings),
      fifty_bonus: n(before.fifty_bonus),
      hundred_bonus: n(before.hundred_bonus),
      three_w_bonus: n(before.three_w_bonus),
      five_w_bonus: n(before.five_w_bonus),
      mom_bonus: n(before.mom_bonus),
    };

    const { error: upErr } = await supabaseAdmin.from("fantasy_players").update(payload).eq("id", playerId);
    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "Scores restored from audit snapshot.", playerId, stats: payload });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Restore failed" },
      { status: 500 }
    );
  }
}
