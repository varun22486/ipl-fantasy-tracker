import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createMatchSnapshot, SNAPSHOT_SOURCE_LABEL, type MatchSnapshotPayload } from "@/lib/match-snapshot";

export async function GET(req: NextRequest) {
  const matchId = parseInt(req.nextUrl.searchParams.get("matchId") ?? "", 10);
  if (!Number.isFinite(matchId) || matchId < 1) {
    return NextResponse.json({ ok: false, error: "matchId required" }, { status: 400 });
  }

  const { data: row } = await supabaseAdmin.from("matches").select("id").eq("id", matchId).maybeSingle();
  if (!row) {
    return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from("match_state_snapshots")
    .select("id, source, summary, created_at, payload")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const snapshots = (data ?? []).map((r) => {
    const p = r.payload as MatchSnapshotPayload | null;
    const playerCount = Array.isArray(p?.players) ? p.players.length : 0;
    const key = r.source as keyof typeof SNAPSHOT_SOURCE_LABEL;
    const label = SNAPSHOT_SOURCE_LABEL[key] ?? r.source;
    return {
      id: r.id,
      source: r.source,
      sourceLabel: label,
      summary: r.summary,
      created_at: r.created_at,
      playerCount,
    };
  });

  return NextResponse.json({ ok: true, snapshots });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const matchId = Number(body?.matchId);
    if (!Number.isFinite(matchId) || matchId < 1) {
      return NextResponse.json({ ok: false, error: "Invalid matchId" }, { status: 400 });
    }

    const sourceRaw = body?.source;
    if (sourceRaw !== "user_checkpoint") {
      return NextResponse.json(
        { ok: false, error: "Only user_checkpoint snapshots can be created from the API." },
        { status: 400 }
      );
    }

    const summary = typeof body?.summary === "string" ? body.summary.trim() : "";

    const { data: row } = await supabaseAdmin.from("matches").select("id").eq("id", matchId).maybeSingle();
    if (!row) {
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    const id = await createMatchSnapshot({
      matchId,
      source: "user_checkpoint",
      summary: summary || "Manual checkpoint",
    });

    if (id == null) {
      return NextResponse.json(
        { ok: false, error: "Could not save snapshot (is match_state_snapshots table created?)" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, snapshotId: id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
