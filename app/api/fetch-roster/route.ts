import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { fetchMatchRoster } from "@/lib/cricket-provider";
import { getDefaultActiveMatchRowForSync } from "@/lib/active-match";
import { parseStoredProviderSquad } from "@/lib/provider-squad-json";

export async function POST(request: Request) {
  try {
    let matchId: number | undefined;
    let forceRefresh = false;
    try {
      const body = await request.json();
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const o = body as Record<string, unknown>;
        if (typeof o.matchId === "number" && Number.isFinite(o.matchId)) matchId = o.matchId;
        if (o.forceRefresh === true) forceRefresh = true;
      }
    } catch {
      /* no body */
    }

    let match: { id: number; external_match_id: string | null; provider_squad_json?: unknown } | null = null;
    let error: { message: string } | null = null;

    if (matchId != null) {
      ({ data: match, error } = await supabaseAdmin
        .from("matches")
        .select("id, external_match_id, provider_squad_json")
        .eq("id", matchId)
        .maybeSingle());
      if (error || !match) {
        return NextResponse.json({ ok: false, error: "Match not found." }, { status: 404 });
      }
    } else {
      const row = await getDefaultActiveMatchRowForSync();
      match = row
        ? {
            id: row.id as number,
            external_match_id: (row.external_match_id as string | null) ?? null,
            provider_squad_json: (row as { provider_squad_json?: unknown }).provider_squad_json,
          }
        : null;
      error = null;
      if (!match) {
        ({ data: match, error } = await supabaseAdmin
          .from("matches")
          .select("id, external_match_id, provider_squad_json")
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle());
      }
      if (error || !match) {
        return NextResponse.json({ ok: false, error: "No linked match found." }, { status: 400 });
      }
    }

    const extId = match.external_match_id as string | null;
    if (!extId) {
      return NextResponse.json({ ok: false, error: "Match has no external ID — cannot fetch roster." }, { status: 400 });
    }

    if (!forceRefresh) {
      const cached = parseStoredProviderSquad(match.provider_squad_json);
      if (cached && cached.rosterNames.length > 0) {
        return NextResponse.json({
          ok: true,
          playerCount: cached.rosterNames.length,
          source: "cache",
        });
      }
    }

    const { squads, rosterNames, nameToId } = await fetchMatchRoster(extId);

    if (rosterNames.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `No player data returned for this match. All API keys may be rate-limited — wait 15 minutes then try again. If the problem persists, check quota at /api/key-stats or debug at /api/debug-roster?id=${extId}`,
      }, { status: 404 });
    }

    await supabaseAdmin
      .from("matches")
      .update({ provider_squad_json: { squads, rosterNames, nameToId } })
      .eq("id", match.id);

    return NextResponse.json({ ok: true, playerCount: rosterNames.length, source: "api" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch roster";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
