import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type SideName = "You" | "Rahul";

type PlayerInput = {
  name: string;
  captain: boolean;
};

function normalizePlayers(players: unknown): PlayerInput[] {
  if (!Array.isArray(players)) return [];
  return players
    .map((player) => ({
      name: String((player as any)?.name || "").trim(),
      captain: Boolean((player as any)?.captain),
    }))
    .filter((player) => player.name);
}

function validateSide(name: SideName, players: PlayerInput[]) {
  if (players.length !== 4) {
    throw new Error(`${name} must have exactly 4 players.`);
  }

  const unique = new Set(players.map((p) => p.name.toLowerCase()));
  if (unique.size !== 4) {
    throw new Error(`${name} has duplicate player names.`);
  }

  if (players.filter((p) => p.captain).length !== 1) {
    throw new Error(`${name} must have exactly 1 Team Captain.`);
  }
}

async function getCurrentMatchId() {
  // Prefer the explicitly-marked current match (same logic as page.tsx)
  const { data: byFlag } = await supabaseAdmin
    .from("matches")
    .select("id")
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  if (byFlag) return byFlag.id;

  // Fallback: most recently inserted match
  const { data: fallback } = await supabaseAdmin
    .from("matches")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!fallback) throw new Error("Seed a match first.");
  return fallback.id;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const yourPlayers = normalizePlayers(body.yourPlayers);
    const opponentPlayers = normalizePlayers(body.opponentPlayers);
    const opponentName = String(body.opponentName || "Rahul").trim() || "Rahul";

    validateSide("You", yourPlayers);
    validateSide("Rahul", opponentPlayers);

    const matchId = await getCurrentMatchId();

    await supabaseAdmin.from("fantasy_players").delete().eq("match_id", matchId);

    const rows = [
      ...yourPlayers.map((p) => ({ match_id: matchId, side: "You", name: p.name, captain: p.captain })),
      ...opponentPlayers.map((p) => ({ match_id: matchId, side: "Rahul", name: p.name, captain: p.captain })),
    ];

    await supabaseAdmin.from("fantasy_players").insert(rows);
    await supabaseAdmin.from("series_settings").update({ opponent_name: opponentName }).eq("id", 1);

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Failed to save lineup" }, { status: 400 });
  }
}
