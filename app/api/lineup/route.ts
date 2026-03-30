import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type PlayerInput = { name: string; captain: boolean; providerId?: string };

function normalizePlayers(players: unknown): PlayerInput[] {
  if (!Array.isArray(players)) return [];
  return players
    .map((p) => ({
      name: String((p as any)?.name || "").trim(),
      captain: Boolean((p as any)?.captain),
      providerId: typeof (p as any)?.providerId === "string" ? (p as any).providerId.trim() || undefined : undefined,
    }))
    .filter((p) => p.name);
}

function validateSide(label: string, players: PlayerInput[]) {
  if (players.length !== 4) throw new Error(`${label} must have exactly 4 players.`);
  if (new Set(players.map((p) => p.name.toLowerCase())).size !== 4) throw new Error(`${label} has duplicate player names.`);
  if (players.filter((p) => p.captain).length !== 1) throw new Error(`${label} must have exactly 1 Team Captain.`);
}

async function getCurrentMatchId() {
  const { data: byFlag } = await supabaseAdmin.from("matches").select("id").eq("is_current", true).limit(1).maybeSingle();
  if (byFlag) return byFlag.id as number;
  const { data: fallback } = await supabaseAdmin.from("matches").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
  if (!fallback) throw new Error("Seed a match first.");
  return fallback.id as number;
}

/**
 * Supports three modes via `saveSide` in the request body:
 *   "mine"   – only update the "You" side (yourPlayers required)
 *   "theirs" – only update the opponent side (opponentPlayers required)
 *   "both"   – update both sides at once (default, backward compatible)
 *
 * Per-side saving lets two users submit concurrently without overwriting
 * each other's picks.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const saveSide: "mine" | "theirs" | "both" = body.saveSide ?? "both";
    const opponentName = String(body.opponentName || "Rahul").trim() || "Rahul";
    const matchId = await getCurrentMatchId();

    if (saveSide === "mine" || saveSide === "both") {
      const yourPlayers = normalizePlayers(body.yourPlayers);
      validateSide("Your team", yourPlayers);
      // Delete only your side, then re-insert
      await supabaseAdmin.from("fantasy_players").delete().eq("match_id", matchId).eq("side", "You");
      await supabaseAdmin.from("fantasy_players").insert(
        yourPlayers.map((p) => ({ match_id: matchId, side: "You", name: p.name, captain: p.captain, provider_player_id: p.providerId ?? null }))
      );
    }

    if (saveSide === "theirs" || saveSide === "both") {
      const opponentPlayers = normalizePlayers(body.opponentPlayers);
      validateSide("Opponent team", opponentPlayers);
      // Delete only opponent side, then re-insert
      await supabaseAdmin.from("fantasy_players").delete().eq("match_id", matchId).eq("side", "Rahul");
      await supabaseAdmin.from("fantasy_players").insert(
        opponentPlayers.map((p) => ({ match_id: matchId, side: "Rahul", name: p.name, captain: p.captain, provider_player_id: p.providerId ?? null }))
      );
    }

    await supabaseAdmin.from("series_settings").update({ opponent_name: opponentName }).eq("id", 1);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Failed to save lineup" }, { status: 400 });
  }
}
