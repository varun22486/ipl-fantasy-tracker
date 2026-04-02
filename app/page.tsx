export const dynamic = "force-dynamic";
import { resolveCompetitionId } from "@/lib/competition";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, playerPoints, scoringFromSettings } from "@/lib/scoring";
import { formatFixture, parseLeagueMatchNumberFromFixture } from "@/lib/format";
import { fetchMatchSeedFromMatchInfo } from "@/lib/cricket-provider";
import { canonicalIstDayForIpl2026LeagueMatch } from "@/lib/ipl-2026-league-dates";
import { pickNextUnplayedMatch } from "@/lib/next-match";
import nextDynamic from "next/dynamic";
import HomeHero from "@/components/HomeHero";
import StatsSectionSkeleton from "@/components/StatsSectionSkeleton";
import Link from "next/link";

const StatsClient = nextDynamic(() => import("@/components/StatsClient"), {
  loading: () => <StatsSectionSkeleton variant="duo" />,
});

const MultiStatsClient = nextDynamic(() => import("@/components/MultiStatsClient"), {
  loading: () => <StatsSectionSkeleton variant="multi" />,
});

function MultiPlayerHero({ participants, nextMatch }: {
  participants: { name: string; totalPoints: number; wins: number; matches: number }[];
  nextMatch: { fixture: string; date: string; venue: string | null } | null;
}) {
  const colors = ["#93c5fd", "#fca5a5", "#86efac", "#fcd34d", "#c4b5fd", "#fdba74"];
  return (
    <section className="home-hero" style={{ marginBottom: 28 }}>
      <div className="home-hero__inner">
        <p className="home-hero__eyebrow">Multi-player competition</p>
        <h2 className="home-hero__title">Series Standings</h2>
        <div className="home-hero__standings">
          {participants.map((p, i) => {
            const pct = participants[0].totalPoints > 0 ? (p.totalPoints / participants[0].totalPoints) * 100 : 0;
            const barColor = colors[i] ?? "#64748b";
            return (
              <div key={p.name} className="home-hero__standings-row">
                <span className="home-hero__standings-rank">#{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="home-hero__standings-name" style={{ color: barColor }}>
                    {p.name}
                  </div>
                  <div className="home-hero__standings-bar">
                    <div
                      className="home-hero__standings-bar-fill"
                      style={{ width: `${pct}%`, background: barColor }}
                    />
                  </div>
                </div>
                <div className="home-hero__standings-meta">
                  <div className="home-hero__standings-pts">{p.totalPoints}</div>
                  <div className="home-hero__standings-sub">
                    {p.wins}W · {p.matches} played
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {nextMatch && (
          <div className="home-hero__next">
            <span>
              <strong>Next:</strong> {nextMatch.fixture}
              {nextMatch.date ? ` · ${nextMatch.date}` : ""}
            </span>
            <Link href="/match" className="home-hero__cta">
              Pick teams
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}

async function getData(competitionId: number | null) {
  const [{ data: matches, error: matchErr }, { data: settings }, { data: competitions }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: true }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("competitions").select("*").order("id", { ascending: true }),
  ]);

  if (matchErr) console.error("[home] matches query error:", matchErr.message);

  // Resolve competition info
  const comp = competitionId != null ? (competitions ?? []).find((c: any) => c.id === competitionId) : null;
  const compPlayers: string[] = comp
    ? (Array.isArray(comp.players) ? comp.players : [comp.player1_name, comp.player2_name])
    : [];
  const isMultiPlayer = compPlayers.length > 2;

  let yourName: string;
  let opponentName: string;
  if (comp) {
    yourName = compPlayers[0] ?? "Player 1";
    opponentName = compPlayers[1] ?? "Player 2";
  } else {
    yourName = (settings as any)?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  // Fetch only this competition's player rows
  const playersQuery = supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true });
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

  // Multi-player: per-match points for each participant
  const participantMatchStats = isMultiPlayer
    ? (matches ?? []).map((m: any) => {
        const mp = playersByMatch[m.id] ?? [];
        const pts: Record<string, number> = {};
        const runs: Record<string, number> = {};
        const wickets: Record<string, number> = {};
        const catches: Record<string, number> = {};
        const captainPts: Record<string, number> = {};
        const captainName: Record<string, string> = {};
        for (const name of compPlayers) {
          const sidePlayers = mp.filter((p: any) => p.side === name);
          pts[name] = sidePlayers.reduce((s: number, p: any) => s + playerPoints(p, rules).final, 0);
          runs[name] = sidePlayers.reduce((s: number, p: any) => s + (p.runs ?? 0), 0);
          wickets[name] = sidePlayers.reduce((s: number, p: any) => s + (p.wickets ?? 0), 0);
          catches[name] = sidePlayers.reduce((s: number, p: any) => s + (p.catches ?? 0), 0);
          const cap = sidePlayers.find((p: any) => p.captain);
          captainPts[name] = cap ? playerPoints(cap, rules).final : 0;
          captainName[name] = cap?.name ?? "—";
        }
        const hasData = Object.values(pts).some(v => v > 0);
        const maxPts = Math.max(...Object.values(pts));
        const leaders = compPlayers.filter(n => pts[n] === maxPts && maxPts > 0);
        const winner = leaders.length === 1 ? leaders[0] : (hasData ? "Tie" : null);
        return {
          matchId: m.id as number,
          fixture: formatFixture(m.fixture) || m.fixture || "TBD",
          date: (m.match_date ?? "") as string,
          pts,
          runs,
          wickets,
          catches,
          captainPts,
          captainName,
          hasData,
          isCurrent: Boolean(m.is_current),
          winner,
        };
      })
    : [];

  const participantTotals: { name: string; totalPoints: number; wins: number; matches: number }[] = isMultiPlayer
    ? compPlayers.map(name => {
        const totalPoints = participantMatchStats.reduce((s, m) => s + (m.pts[name] ?? 0), 0);
        const wins = participantMatchStats.filter(m => m.winner === name).length;
        return { name, totalPoints, wins, matches: participantMatchStats.filter(m => m.hasData).length };
      }).sort((a, b) => b.totalPoints - a.totalPoints)
    : [];

  const matchIdsWithPlayers = new Set<number>();
  for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
    const mid = (p as any).match_id as number;
    if (typeof mid === "number" && mid >= 1) matchIdsWithPlayers.add(mid);
  }

  const nextMatchRow = pickNextUnplayedMatch(matches ?? [], matchIdsWithPlayers);
  let nextFixture = nextMatchRow?.fixture as string | undefined;
  let nextDate = nextMatchRow?.match_date as string | undefined;
  let nextVenue = (nextMatchRow as { venue?: string | null } | null)?.venue ?? null;
  if (nextMatchRow && (nextMatchRow as { external_match_id?: string }).external_match_id) {
    try {
      const fresh = await fetchMatchSeedFromMatchInfo(String((nextMatchRow as { external_match_id: string }).external_match_id));
      if (fresh) {
        if (fresh.fixture) nextFixture = fresh.fixture;
        if (fresh.match_date) nextDate = fresh.match_date;
        if (fresh.venue != null && String(fresh.venue).trim() !== "") nextVenue = fresh.venue;
      }
    } catch {
      /* quota / network — keep DB values */
    }
  }

  const leagueNo = parseLeagueMatchNumberFromFixture(
    String(nextFixture ?? (nextMatchRow as { fixture?: string } | null)?.fixture ?? "")
  );
  const canonDay = canonicalIstDayForIpl2026LeagueMatch(leagueNo);
  if (canonDay) nextDate = canonDay;

  const nextMatch = nextMatchRow ?? null;

  return {
    yourName,
    opponentName,
    matchStats,
    leaderboard,
    isMultiPlayer,
    compPlayers,
    participantTotals,
    participantMatchStats,
    nextMatch: nextMatch
      ? {
          fixture: formatFixture(nextFixture || nextMatch.fixture) || nextFixture || nextMatch.fixture || "TBD",
          date: String(nextDate ?? nextMatch.match_date ?? ""),
          venue: nextVenue ?? nextMatch.venue ?? null,
        }
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
  const competitionId = await resolveCompetitionId(c);
  const data = await getData(competitionId);
  return (
    <main className="page-main">
      {data.isMultiPlayer ? (
        <MultiPlayerHero participants={data.participantTotals} nextMatch={data.nextMatch} />
      ) : (
        <HomeHero
          yourName={data.yourName}
          opponentName={data.opponentName}
          summary={data.summary}
          nextMatch={data.nextMatch}
        />
      )}
      {data.isMultiPlayer ? (
        <MultiStatsClient
          participants={data.participantTotals}
          matchStats={data.participantMatchStats}
          compPlayers={data.compPlayers}
          competitionId={competitionId}
        />
      ) : (
        <StatsClient
          yourName={data.yourName}
          opponentName={data.opponentName}
          matchStats={data.matchStats}
          leaderboard={data.leaderboard}
          summary={data.summary}
        />
      )}
    </main>
  );
}
