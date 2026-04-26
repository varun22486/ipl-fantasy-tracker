import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { createMatchSnapshot } from "@/lib/match-snapshot";
import { DEFAULT_LINEUP_LATENESS_POINTS } from "@/lib/lineup-lateness";

type Body = {
  matchId?: number;
  /** When true, write penalty; when false, clear. */
  enabled?: boolean;
  /** One or more participant display names (must match comp / series names). */
  lateParticipants?: string[] | null;
  /** @deprecated use lateParticipants; if present without array, single name. */
  lateParticipant?: string | null;
  points?: number;
  /** Required when validating names for named competitions. */
  competitionId?: number | null;
};

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    const k = norm(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const matchId = Number(body?.matchId);
    const enabled = Boolean(body?.enabled);
    const fromArr = Array.isArray(body?.lateParticipants) ? body.lateParticipants : null;
    const legacyOne = body?.lateParticipant != null ? String(body.lateParticipant).trim() : "";
    const lateList =
      fromArr && fromArr.length > 0
        ? dedupeNames(fromArr.map((x) => String(x)))
        : legacyOne
          ? [legacyOne]
          : [];
    let points = Number(body?.points);
    if (!Number.isFinite(points) || points < 1) points = DEFAULT_LINEUP_LATENESS_POINTS;
    points = Math.min(10_000, Math.floor(points));

    if (!Number.isFinite(matchId) || matchId < 1) {
      return NextResponse.json({ ok: false, error: "Invalid matchId" }, { status: 400 });
    }

    const { data: mrow, error: fetchErr } = await supabaseAdmin
      .from("matches")
      .select("id, external_match_id")
      .eq("id", matchId)
      .maybeSingle();

    if (fetchErr || !mrow) {
      return NextResponse.json({ ok: false, error: "Match not found" }, { status: 404 });
    }

    const ext = mrow.external_match_id as string | null;
    if (!ext || !String(ext).trim()) {
      return NextResponse.json(
        { ok: false, error: "Link a provider match first (this match is not linked)." },
        { status: 400 }
      );
    }

    if (enabled) {
      if (lateList.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Select who was late (one or more), or turn off the penalty." },
          { status: 400 }
        );
      }

      const compId = body.competitionId != null && Number.isFinite(Number(body.competitionId)) ? Number(body.competitionId) : null;
      let allowed: string[] = [];
      if (compId == null) {
        const { data: settings } = await supabaseAdmin.from("series_settings").select("your_name, opponent_name").limit(1).maybeSingle();
        const y = String(settings?.your_name ?? "You").trim() || "You";
        const o = String(settings?.opponent_name ?? "Rahul").trim() || "Rahul";
        allowed = [y, o];
      } else {
        const { data: comp, error: cErr } = await supabaseAdmin.from("competitions").select("players, player1_name, player2_name").eq("id", compId).maybeSingle();
        if (cErr || !comp) {
          return NextResponse.json({ ok: false, error: "Competition not found" }, { status: 400 });
        }
        allowed = Array.isArray((comp as { players?: unknown }).players)
          ? ((comp as { players: string[] }).players as string[]).map((n) => String(n).trim()).filter(Boolean)
          : [String((comp as { player1_name?: string }).player1_name ?? ""), String((comp as { player2_name?: string }).player2_name ?? "")].filter(Boolean);
        if (allowed.length === 0) {
          return NextResponse.json({ ok: false, error: "Competition has no player names" }, { status: 400 });
        }
      }

      for (const name of lateList) {
        if (!allowed.some((n) => norm(n) === norm(name))) {
          return NextResponse.json(
            { ok: false, error: `“${name}” is not a participant in this competition.` },
            { status: 400 }
          );
        }
      }
    }

    await createMatchSnapshot({
      matchId,
      source: "pre_lineup_lateness",
      summary: enabled ? "Before late-select on-time bonus" : "Before clearing late-select on-time bonus",
    });

    const { error: upErr } = await supabaseAdmin
      .from("matches")
      .update(
        enabled
          ? {
              lineup_lateness_enabled: true,
              lineup_late_participants: lateList,
              lineup_late_participant: lateList.length === 1 ? lateList[0]! : null,
              lineup_lateness_points: points,
            }
          : {
              lineup_lateness_enabled: false,
              lineup_late_participants: null,
              lineup_late_participant: null,
              lineup_lateness_points: DEFAULT_LINEUP_LATENESS_POINTS,
            }
      )
      .eq("id", matchId);

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    }

    const describe =
      !enabled || lateList.length === 0
        ? ""
        : lateList.length === 1
          ? `On-time players get +${points} pts; “${lateList[0]}” (late) gets no bonus.`
          : `On-time players get +${points} pts each; ${lateList.map((n) => `“${n}”`).join(", ")} (late) get no bonus.`;

    return NextResponse.json({
      ok: true,
      enabled,
      lateParticipants: enabled ? lateList : [],
      points: enabled ? points : DEFAULT_LINEUP_LATENESS_POINTS,
      message: enabled
        ? `Late-select rule on: ${describe}`
        : "Late-select rule cleared — only synced fantasy points apply.",
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
