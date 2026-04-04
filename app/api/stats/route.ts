import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, fantasyPointsCounted, playerPoints } from "@/lib/scoring";
import { formatFixture } from "@/lib/format";

export async function GET() {
  try {
    const [{ data: matches }, { data: allPlayers }, { data: settings }] = await Promise.all([
      supabaseAdmin.from("matches").select("id,fixture,match_date,status").order("id", { ascending: true }),
      supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true }),
      supabaseAdmin.from("series_settings").select("opponent_name").limit(1).single(),
    ]);

    const opponentName = settings?.opponent_name ?? "Rahul";

    // Group players by match
    const playersByMatch: Record<number, FantasyPlayer[]> = {};
    for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
      const mid = (p as any).match_id as number;
      if (!playersByMatch[mid]) playersByMatch[mid] = [];
      playersByMatch[mid].push(p);
    }

    // Build per-match stats
    let yourCumulative = 0;
    let oppCumulative = 0;
    const matchStats = (matches ?? []).map((m: any) => {
      const mp = playersByMatch[m.id] ?? [];
      const yourPlayers = mp.filter((p) => p.side === "You");
      const oppPlayers = mp.filter((p) => p.side === "Rahul");
      const yourPts = yourPlayers.reduce((s, p) => s + fantasyPointsCounted(p), 0);
      const oppPts = oppPlayers.reduce((s, p) => s + fantasyPointsCounted(p), 0);
      yourCumulative += yourPts;
      oppCumulative += oppPts;

      const winner = yourPts > oppPts ? "You" : oppPts > yourPts ? opponentName : yourPts > 0 ? "Tie" : null;
      const players = mp.map((p) => ({
        name: p.name,
        side: p.side,
        captain: p.captain,
        points: fantasyPointsCounted(p),
        runs: p.runs,
        wickets: p.wickets,
        catches: p.catches,
        runouts: p.runouts ?? 0,
        stumpings: p.stumpings ?? 0,
      }));

      return {
        matchId: m.id,
        fixture: formatFixture(m.fixture) || m.fixture,
        date: m.match_date,
        yourPoints: yourPts,
        oppPoints: oppPts,
        yourCumulative,
        oppCumulative,
        winner,
        pointsDiff: Math.abs(yourPts - oppPts),
        hasData: yourPts > 0 || oppPts > 0,
        players,
      };
    });

    // Player leaderboard across all matches
    const leaderboard: Record<string, { name: string; side: string; totalPoints: number; matches: number; runs: number; wickets: number; catches: number; runouts: number; stumpings: number }> = {};
    for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
      const key = `${p.side}::${p.name}`;
      if (!leaderboard[key]) leaderboard[key] = { name: p.name, side: p.side, totalPoints: 0, matches: 0, runs: 0, wickets: 0, catches: 0, runouts: 0, stumpings: 0 };
      leaderboard[key].totalPoints += fantasyPointsCounted(p);
      leaderboard[key].matches += 1;
      leaderboard[key].runs += p.runs;
      leaderboard[key].wickets += p.wickets;
      leaderboard[key].catches += p.catches;
      leaderboard[key].runouts += p.runouts ?? 0;
      leaderboard[key].stumpings += p.stumpings ?? 0;
    }

    const yourWins = matchStats.filter((m) => m.winner === "You").length;
    const oppWins = matchStats.filter((m) => m.winner === opponentName).length;
    const ties = matchStats.filter((m) => m.winner === "Tie").length;

    return NextResponse.json({
      ok: true,
      opponentName,
      matchStats,
      leaderboard: Object.values(leaderboard).sort((a, b) => b.totalPoints - a.totalPoints),
      summary: {
        yourWins,
        oppWins,
        ties,
        yourTotal: yourCumulative,
        oppTotal: oppCumulative,
        matchesPlayed: matchStats.filter((m) => m.hasData).length,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
