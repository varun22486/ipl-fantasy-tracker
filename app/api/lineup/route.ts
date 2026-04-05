import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type PlayerInput = { name: string; captain: boolean; bench?: boolean; providerId?: string };

function normalizePlayers(players: unknown): PlayerInput[] {
  if (!Array.isArray(players)) return [];
  return players
    .map((p) => ({
      name: String((p as any)?.name || "").trim(),
      captain: Boolean((p as any)?.captain),
      bench: Boolean((p as any)?.bench),
      providerId: typeof (p as any)?.providerId === "string" ? (p as any).providerId.trim() || undefined : undefined,
    }))
    .filter((p) => p.name);
}

/** 4 starters (bench false) + up to 3 super subs (bench true). Legacy: 4 rows, all starters. */
function validateSide(label: string, players: PlayerInput[]) {
  const named = players.filter((p) => p.name);
  if (named.length < 4 || named.length > 7) {
    throw new Error(`${label}: pick 4–7 players (4 count for points; up to 3 super subs).`);
  }
  const starters = named.filter((p) => !p.bench);
  const subs = named.filter((p) => p.bench);
  if (starters.length !== 4) {
    throw new Error(`${label}: exactly 4 must be playing XI (not super sub). Re-save from the latest team picker.`);
  }
  if (subs.length > 3) throw new Error(`${label}: at most 3 super subs.`);
  if (starters.filter((p) => p.captain).length !== 1) {
    throw new Error(`${label}: exactly 1 Team Captain among the playing 4.`);
  }
  if (subs.some((p) => p.captain)) throw new Error(`${label}: captain must be one of the playing 4, not a super sub.`);
  const keys = named.map((p) => p.name.toLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error(`${label} has duplicate player names.`);
}

async function getCurrentMatchId() {
  const { data: byFlag } = await supabaseAdmin.from("matches").select("id").eq("is_current", true).limit(1).maybeSingle();
  if (byFlag) return byFlag.id as number;
  const { data: fallback } = await supabaseAdmin.from("matches").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
  if (!fallback) throw new Error("Seed a match first.");
  return fallback.id as number;
}

/** When `body.matchId` is set, lineup changes apply to that fixture (e.g. completed match from History). */
async function resolveLineupMatchId(body: { matchId?: unknown }): Promise<number> {
  const raw = body.matchId;
  if (raw != null && raw !== "") {
    const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
    if (Number.isFinite(n) && n > 0) {
      const id = Math.floor(n);
      const { data: row } = await supabaseAdmin.from("matches").select("id").eq("id", id).maybeSingle();
      if (!row) throw new Error("Match not found.");
      return row.id as number;
    }
  }
  return getCurrentMatchId();
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
 *   matchId?: number — optional; target this DB match (defaults to current match)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const saveSide: "mine" | "theirs" | "both" = body.saveSide ?? "both";
    const matchId = await resolveLineupMatchId(body);

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
          bench: p.bench === true,
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
          bench: p.bench === true,
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
          bench: p.bench === true,
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
