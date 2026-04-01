export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, playerPoints, scoringFromSettings } from "@/lib/scoring";
import { formatFixture } from "@/lib/format";
import StatsClient from "@/components/StatsClient";
import HomeHero from "@/components/HomeHero";

async function getData(competitionId: number | null) {
  const [{ data: matches, error: matchErr }, { data: settings }, { data: competitions }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: true }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("competitions").select("*").order("id", { ascending: true }),
  ]);

  if (matchErr) console.error("[home] matches query error:", matchErr.message);

  // Resolve player names for the active competition
  let yourName: string;
  let opponentName: string;
  if (competitionId != null) {
    const comp = (competitions ?? []).find((c: any) => c.id === competitionId);
    yourName = comp?.player1_name ?? "Player 1";
    opponentName = comp?.player2_name ?? "Player 2";
  } else {
    yourName = (settings as any)?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  // Fetch only this competition's player rows
  const playersQuery = supabaseAdmin
    .from("fantasy_players")
    .select("*")
    .order("id", { ascending: true });
  const { data: allPlayers } = competitionId != null
    ? await playersQuery.eq("competition_id", competitionId)
    : await playersQuery.is("competition_id", null);
  const rules = scoringFromSettings(settings as any);

  // Determine which side value means "player 1 / you"
  const player1Side = competitionId != null ? yourName : "You";

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
    const yourPlayers = mp.filter((p) => p.side === player1Side);
    const oppPlayers = mp.filter((p) => p.side !== player1Side);
    const yourPts = yourPlayers.reduce((s, p) => s + playerPoints(p, rules).final, 0);
    const oppPts = oppPlayers.reduce((s, p) => s + playerPoints(p, rules).final, 0);
    yourCumulative += yourPts;
    oppCumulative += oppPts;

    const winner = yourPts > oppPts ? yourName : oppPts > yourPts ? opponentName : yourPts > 0 ? "Tie" : null;
    const players = mp.map((p) => ({
      name: p.name,
      side: p.side as "You" | string,
      captain: p.captain,
      points: playerPoints(p, rules).final,
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
    leaderMap[key].totalPoints += playerPoints(p, rules).final;
    leaderMap[key].matches += 1;
    leaderMap[key].runs += p.runs;
    leaderMap[key].wickets += p.wickets;
    leaderMap[key].catches += p.catches;
  }

  const leaderboard = Object.values(leaderMap).sort((a, b) => b.totalPoints - a.totalPoints);
  const yourWins = matchStats.filter((m) => m.winner === yourName).length;
  const oppWins = matchStats.filter((m) => m.winner === opponentName).length;
  const ties = matchStats.filter((m) => m.winner === "Tie").length;

  // Next unplayed match — first match with no data and a future-or-today date
  const today = new Date().toISOString().slice(0, 10);
  const nextMatch = (matches ?? []).find((m: any) => {
    const hasPlayers = (playersByMatch[m.id] ?? []).length > 0;
    return !hasPlayers && (m.match_date ?? "") >= today;
  }) ?? null;

  return {
    yourName,
    opponentName,
    matchStats,
    leaderboard,
    nextMatch: nextMatch
      ? { fixture: formatFixture(nextMatch.fixture) || nextMatch.fixture || "TBD", date: nextMatch.match_date ?? "", venue: nextMatch.venue ?? null }
      : null,
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

export default async function Home({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const competitionId = c ? Number(c) : null;
  const data = await getData(competitionId);
  return (
    <main className="page-main">
      <HomeHero
        yourName={data.yourName}
        opponentName={data.opponentName}
        summary={data.summary}
        nextMatch={data.nextMatch}
      />
      <StatsClient
        yourName={data.yourName}
        opponentName={data.opponentName}
        matchStats={data.matchStats}
        leaderboard={data.leaderboard}
        summary={data.summary}
      />
    </main>
  );
}
