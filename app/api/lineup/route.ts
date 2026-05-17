import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { resolveDefaultMatchIdFromPreferences, ACTIVE_MATCH_COOKIE } from "@/lib/active-match";
import {
  isLateMatchChangeContext,
  recordFantasyAuditEvent,
  lineupSnapshotsEqual,
} from "@/lib/match-audit";
import { createMatchSnapshot } from "@/lib/match-snapshot";
import { isFantasyBench } from "@/lib/scoring";
import { competitionH2hSides } from "@/lib/competition-participants";

type PlayerInput = { name: string; captain: boolean; bench: boolean; providerId?: string };

function normalizePlayers(players: unknown): PlayerInput[] {
  if (!Array.isArray(players)) return [];
  return players
    .map((p) => ({
      name: String((p as any)?.name || "").trim(),
      captain: Boolean((p as any)?.captain),
      bench: isFantasyBench({ bench: (p as any)?.bench }),
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

/** Prior row for this match+side — used to carry stats across delete+insert lineup saves. */
type ExistingFp = {
  name?: unknown;
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
  provider_player_id?: unknown;
};

function fantasyStatsByLowerName(rows: ExistingFp[]): Map<string, ExistingFp> {
  const m = new Map<string, ExistingFp>();
  for (const r of rows) {
    const k = String(r.name ?? "").trim().toLowerCase();
    if (k) m.set(k, r);
  }
  return m;
}

function numCol(prev: ExistingFp | undefined, key: keyof ExistingFp): number {
  if (!prev) return 0;
  const x = Number(prev[key] ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function preservedStatsAndProvider(prev: ExistingFp | undefined, pick: PlayerInput) {
  const pid =
    pick.providerId?.trim() ||
    (typeof prev?.provider_player_id === "string" ? prev.provider_player_id.trim() : "") ||
    null;
  return {
    runs: numCol(prev, "runs"),
    wickets: numCol(prev, "wickets"),
    catches: numCol(prev, "catches"),
    runouts: numCol(prev, "runouts"),
    stumpings: numCol(prev, "stumpings"),
    fifty_bonus: numCol(prev, "fifty_bonus"),
    hundred_bonus: numCol(prev, "hundred_bonus"),
    three_w_bonus: numCol(prev, "three_w_bonus"),
    five_w_bonus: numCol(prev, "five_w_bonus"),
    mom_bonus: numCol(prev, "mom_bonus"),
    provider_player_id: pid,
  };
}

async function defaultLineupMatchId(req: NextRequest): Promise<number> {
  const cookieVal = req.cookies.get(ACTIVE_MATCH_COOKIE)?.value;
  return resolveDefaultMatchIdFromPreferences(cookieVal ?? undefined);
}

/** When `body.matchId` is set, lineup changes apply to that fixture (e.g. completed match from History). */
async function resolveLineupMatchId(req: NextRequest, body: { matchId?: unknown }): Promise<number> {
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
  return defaultLineupMatchId(req);
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
    const matchId = await resolveLineupMatchId(req, body);

    await createMatchSnapshot({
      matchId,
      source: "pre_lineup",
      summary: "Before lineup save",
    });

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
      const { data: comp } = await supabaseAdmin
        .from("competitions")
        .select("player1_name, player2_name, players")
        .eq("id", competitionId)
        .single();
      if (!comp) throw new Error("Competition not found.");
      const h2h = competitionH2hSides(comp);
      side1 = h2h.side1;
      side2 = h2h.side2;
    }

    const baseFilter = isDefault
      ? (q: any) => q.eq("match_id", matchId).is("competition_id", null)
      : (q: any) => q.eq("match_id", matchId).eq("competition_id", competitionId);

    const { data: matchMeta } = await supabaseAdmin
      .from("matches")
      .select("match_date,status")
      .eq("id", matchId)
      .maybeSingle();
    const auditLate = isLateMatchChangeContext(
      matchMeta?.match_date as string | undefined,
      matchMeta?.status as string | undefined
    );
    const compIdForAudit: number | null = isDefault ? null : competitionId;

    async function snapshotSide(sideLabel: string) {
      const { data } = await baseFilter(supabaseAdmin.from("fantasy_players").select("name,captain,bench")).eq(
        "side",
        sideLabel
      );
      return (data ?? []).map((r) => ({
        name: r.name as string,
        captain: Boolean(r.captain),
        bench: isFantasyBench(r),
      }));
    }

    // Helper: insert rows and throw on error (previously errors were silently swallowed)
    async function insertPlayers(rows: object[]) {
      const { error } = await supabaseAdmin.from("fantasy_players").insert(rows);
      if (error) throw new Error(`Save failed: ${error.message}`);
    }

    async function replaceFantasyLineupSide(sideLabel: string, picks: PlayerInput[]) {
      const { data: existing } = await baseFilter(supabaseAdmin.from("fantasy_players").select("*")).eq("side", sideLabel);
      const byName = fantasyStatsByLowerName((existing ?? []) as ExistingFp[]);
      await baseFilter(supabaseAdmin.from("fantasy_players").delete()).eq("side", sideLabel);
      await insertPlayers(
        picks.map((p) => {
          const prev = byName.get(p.name.toLowerCase());
          return {
            match_id: matchId,
            side: sideLabel,
            name: p.name,
            captain: p.captain,
            bench: p.bench === true,
            competition_id: isDefault ? null : competitionId,
            ...preservedStatsAndProvider(prev, p),
          };
        })
      );
    }

    // New: save for any named participant in a multi-player competition
    if (body.playerName) {
      const playerName = String(body.playerName).trim();
      const playerPicks = normalizePlayers(body.players);
      validateSide(`${playerName}'s team`, playerPicks);
      const beforeSnap = auditLate ? await snapshotSide(playerName) : [];
      await replaceFantasyLineupSide(playerName, playerPicks);
      if (auditLate) {
        const afterSnap = playerPicks.map((p) => ({
          name: p.name,
          captain: p.captain,
          bench: p.bench === true,
        }));
        if (!lineupSnapshotsEqual(beforeSnap, afterSnap)) {
          await recordFantasyAuditEvent({
            matchId,
            competitionId: compIdForAudit,
            action: "lineup_change",
            side: playerName,
            summary: `Lineup changed — ${playerName}`,
            detail: { before: beforeSnap, after: afterSnap },
          });
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (saveSide === "mine" || saveSide === "both") {
      const yourPlayers = normalizePlayers(body.yourPlayers);
      validateSide(`${side1}'s team`, yourPlayers);
      const beforeMine = auditLate ? await snapshotSide(side1) : [];
      await replaceFantasyLineupSide(side1, yourPlayers);
      if (auditLate) {
        const afterSnap = yourPlayers.map((p) => ({
          name: p.name,
          captain: p.captain,
          bench: p.bench === true,
        }));
        if (!lineupSnapshotsEqual(beforeMine, afterSnap)) {
          await recordFantasyAuditEvent({
            matchId,
            competitionId: compIdForAudit,
            action: "lineup_change",
            side: side1,
            summary: `Lineup changed — ${side1}`,
            detail: { before: beforeMine, after: afterSnap },
          });
        }
      }
    }

    if (saveSide === "theirs" || saveSide === "both") {
      const opponentPlayers = normalizePlayers(body.opponentPlayers);
      validateSide(`${side2}'s team`, opponentPlayers);
      const beforeTheirs = auditLate ? await snapshotSide(side2) : [];
      await replaceFantasyLineupSide(side2, opponentPlayers);
      if (auditLate) {
        const afterSnap = opponentPlayers.map((p) => ({
          name: p.name,
          captain: p.captain,
          bench: p.bench === true,
        }));
        if (!lineupSnapshotsEqual(beforeTheirs, afterSnap)) {
          await recordFantasyAuditEvent({
            matchId,
            competitionId: compIdForAudit,
            action: "lineup_change",
            side: side2,
            summary: `Lineup changed — ${side2}`,
            detail: { before: beforeTheirs, after: afterSnap },
          });
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Failed to save lineup" }, { status: 400 });
  }
}
