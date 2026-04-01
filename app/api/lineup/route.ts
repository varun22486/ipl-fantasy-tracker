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
 * Lineup save endpoint — supports both the legacy default competition
 * (competition_id = null, side = "You" / opponentName) and named competitions
 * (competition_id = N, side = player1_name / player2_name).
 *
 * Body:
 *   saveSide: "mine" | "theirs" | "both"
 *   competitionId?: number | null   — null = default (Varun vs Rahul from series_settings)
 *   player1Name?: string            — required when competitionId is set
 *   player2Name?: string            — required when competitionId is set
 *   opponentName?: string           — used for default competition display
 *   yourPlayers?: PlayerInput[]
 *   opponentPlayers?: PlayerInput[]
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const saveSide: "mine" | "theirs" | "both" = body.saveSide ?? "both";
    const matchId = await getCurrentMatchId();

    // Resolve competition context
    const rawCompId = body.competitionId;
    const competitionId: number | null = rawCompId != null ? Number(rawCompId) : null;
    const isDefault = competitionId == null;

    // Side labels depend on whether this is the default or a named competition
    let side1: string;
    let side2: string;

    if (isDefault) {
      side1 = "You";
      side2 = String(body.opponentName || "Rahul").trim() || "Rahul";
      // Keep series_settings.opponent_name in sync for display
      await supabaseAdmin.from("series_settings").update({ opponent_name: side2 }).eq("id", 1);
    } else {
      // Fetch competition to get player names
      const { data: comp } = await supabaseAdmin.from("competitions").select("player1_name, player2_name").eq("id", competitionId).single();
      if (!comp) throw new Error("Competition not found.");
      side1 = comp.player1_name;
      side2 = comp.player2_name;
    }

    const baseFilter = isDefault
      ? (q: any) => q.eq("match_id", matchId).is("competition_id", null)
      : (q: any) => q.eq("match_id", matchId).eq("competition_id", competitionId);

    // Helper: insert rows and throw on error (previously errors were silently swallowed)
    async function insertPlayers(rows: object[]) {
      const { error } = await supabaseAdmin.from("fantasy_players").insert(rows);
      if (error) throw new Error(`Save failed: ${error.message}`);
    }

    // New: save for any named participant in a multi-player competition
    if (body.playerName) {
      const playerName = String(body.playerName).trim();
      const playerPicks = normalizePlayers(body.players);
      validateSide(`${playerName}'s team`, playerPicks);
      await baseFilter(supabaseAdmin.from("fantasy_players").delete()).eq("side", playerName);
      await insertPlayers(
        playerPicks.map((p) => ({
          match_id: matchId,
          side: playerName,
          name: p.name,
          captain: p.captain,
          provider_player_id: p.providerId ?? null,
          competition_id: isDefault ? null : competitionId,
        }))
      );
      return NextResponse.json({ ok: true });
    }

    if (saveSide === "mine" || saveSide === "both") {
      const yourPlayers = normalizePlayers(body.yourPlayers);
      validateSide(`${side1}'s team`, yourPlayers);
      await baseFilter(supabaseAdmin.from("fantasy_players").delete()).eq("side", side1);
      await insertPlayers(
        yourPlayers.map((p) => ({
          match_id: matchId,
          side: side1,
          name: p.name,
          captain: p.captain,
          provider_player_id: p.providerId ?? null,
          competition_id: isDefault ? null : competitionId,
        }))
      );
    }

    if (saveSide === "theirs" || saveSide === "both") {
      const opponentPlayers = normalizePlayers(body.opponentPlayers);
      validateSide(`${side2}'s team`, opponentPlayers);
      await baseFilter(supabaseAdmin.from("fantasy_players").delete()).eq("side", side2);
      await insertPlayers(
        opponentPlayers.map((p) => ({
          match_id: matchId,
          side: side2,
          name: p.name,
          captain: p.captain,
          provider_player_id: p.providerId ?? null,
          competition_id: isDefault ? null : competitionId,
        }))
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Failed to save lineup" }, { status: 400 });
  }
}
