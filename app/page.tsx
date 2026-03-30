export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, playerPoints } from "@/lib/scoring";
import { formatFixture } from "@/lib/format";
import StatsClient from "@/components/StatsClient";

async function getData() {
  const [{ data: matches, error: matchErr }, { data: allPlayers }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: true }),
    supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true }),
    supabaseAdmin.from("series_settings").select("opponent_name").limit(1).single(),
  ]);

  if (matchErr) console.error("[home] matches query error:", matchErr.message);
  const opponentName = settings?.opponent_name ?? "Rahul";

  const playersByMatch: Record<number, FantasyPlayer[]> = {};
  for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
    const mid = (p as any).match_id as number;
    if (!playersByMatch[mid]) playersByMatch[mid] = [];
    playersByMatch[mid].push(p);
  }

  type MatchStatRow = {
    matchId: number; fixture: string; date: string; yourPoints: number; oppPoints: number;
    yourCumulative: number; oppCumulative: number; winner: string | null;
    pointsDiff: number; hasData: boolean; isCurrent: boolean;
    players: { name: string; side: string; captain: boolean; points: number; runs: number; wickets: number; catches: number }[];
  };

  let yourCumulative = 0;
  let oppCumulative = 0;
  const matchStats: MatchStatRow[] = (matches ?? []).map((m: any) => {
    const mp = playersByMatch[m.id] ?? [];
    const yourPlayers = mp.filter((p) => p.side === "You");
    const oppPlayers = mp.filter((p) => p.side !== "You");
    const yourPts = yourPlayers.reduce((s, p) => s + playerPoints(p).final, 0);
    const oppPts = oppPlayers.reduce((s, p) => s + playerPoints(p).final, 0);
    yourCumulative += yourPts;
    oppCumulative += oppPts;

    const winner = yourPts > oppPts ? "You" : oppPts > yourPts ? opponentName : yourPts > 0 ? "Tie" : null;
    const players = mp.map((p) => ({
      name: p.name,
      side: p.side as "You" | string,
      captain: p.captain,
      points: playerPoints(p).final,
      runs: p.runs,
      wickets: p.wickets,
      catches: p.catches,
    }));

    return {
      matchId: m.id as number,
      fixture: formatFixture(m.fixture) || m.fixture || "TBD",
      date: m.match_date ?? "",
      yourPoints: yourPts,
      oppPoints: oppPts,
      yourCumulative,
      oppCumulative,
      winner,
      pointsDiff: Math.abs(yourPts - oppPts),
      hasData: yourPts > 0 || oppPts > 0,
      isCurrent: Boolean(m.is_current),
      players,
    };
  });

  const leaderMap: Record<string, { name: string; side: string; totalPoints: number; matches: number; runs: number; wickets: number; catches: number }> = {};
  for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
    const key = `${p.side}::${p.name}`;
    if (!leaderMap[key]) leaderMap[key] = { name: p.name, side: p.side, totalPoints: 0, matches: 0, runs: 0, wickets: 0, catches: 0 };
    leaderMap[key].totalPoints += playerPoints(p).final;
    leaderMap[key].matches += 1;
    leaderMap[key].runs += p.runs;
    leaderMap[key].wickets += p.wickets;
    leaderMap[key].catches += p.catches;
  }

  const leaderboard = Object.values(leaderMap).sort((a, b) => b.totalPoints - a.totalPoints);
  const yourWins = matchStats.filter((m) => m.winner === "You").length;
  const oppWins = matchStats.filter((m) => m.winner === opponentName).length;
  const ties = matchStats.filter((m) => m.winner === "Tie").length;

  return {
    opponentName,
    matchStats,
    leaderboard,
    summary: {
      yourWins,
      oppWins,
      ties,
      yourTotal: yourCumulative,
      oppTotal: oppCumulative,
      matchesPlayed: matchStats.filter((m) => m.hasData).length,
    },
  };
}

export default async function Home() {
  const data = await getData();
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <StatsClient {...data} />
    </main>
  );
}
