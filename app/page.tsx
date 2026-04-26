export const dynamic = "force-dynamic";
import { resolveCompetitionId } from "@/lib/competition";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, fantasyPointsCounted, isFantasyBench, playerPoints, scoringFromSettings } from "@/lib/scoring";
import { formatFixture, parseLeagueMatchNumberFromFixture } from "@/lib/format";
import { canonicalIstDayForIpl2026LeagueMatch } from "@/lib/ipl-2026-league-dates";
import { pickNextUnplayedMatch } from "@/lib/next-match";
import { isPointsVoidedMatchStatus } from "@/lib/match-void";
import { lineupLatenessSideAdjustment, matchLineupForCompetition } from "@/lib/lineup-lateness";
import nextDynamic from "next/dynamic";
import HomeHero from "@/components/HomeHero";
import SeriesStandingsHero from "@/components/SeriesStandingsHero";
import StatsSectionSkeleton from "@/components/StatsSectionSkeleton";

const StatsClient = nextDynamic(() => import("@/components/StatsClient"), {
  loading: () => <StatsSectionSkeleton variant="duo" />,
});

const MultiStatsClient = nextDynamic(() => import("@/components/MultiStatsClient"), {
  loading: () => <StatsSectionSkeleton variant="multi" />,
});

const HOME_MATCH_COLS =
  "id, fixture, match_date, status, venue, is_current, external_match_id, live_summary, fantasy_voided, lineup_lateness_enabled, lineup_late_participant, lineup_late_participants, lineup_lateness_points, lineup_lateness_by_comp";

async function getData(competitionId: number | null) {
  // Use select("*") so the page still works if optional columns (runouts, stumpings, pts_runout, …)
  // are not migrated yet on the remote DB — explicit column lists make PostgREST fail entirely.
  const playersBase = supabaseAdmin
    .from("fantasy_players")
    .select("*")
    .order("id", { ascending: true });
  const playersPromise =
    competitionId != null
      ? playersBase.eq("competition_id", competitionId)
      : playersBase.is("competition_id", null);

  const [
    { data: matches, error: matchErr },
    { data: settings, error: settingsErr },
    { data: competitions, error: competitionsErr },
    { data: allPlayers, error: playersErr },
  ] = await Promise.all([
    supabaseAdmin.from("matches").select(HOME_MATCH_COLS).order("id", { ascending: true }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin
      .from("competitions")
      .select("id, name, player1_name, player2_name, players")
      .order("id", { ascending: true }),
    playersPromise,
  ]);

  if (matchErr) console.error("[home] matches query error:", matchErr.message);
  if (settingsErr) console.error("[home] series_settings query error:", settingsErr.message);
  if (competitionsErr) console.error("[home] competitions query error:", competitionsErr.message);
  if (playersErr) console.error("[home] fantasy_players query error:", playersErr.message);

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

  const rules = scoringFromSettings(settings as any);

  const voidedMatchIds = new Set<number>();
  for (const m of matches ?? []) {
    const row = m as { id?: number; status?: string; live_summary?: string | null; fantasy_voided?: boolean | null };
    if (typeof row.id === "number" && isPointsVoidedMatchStatus(row.status, row.live_summary, row.fantasy_voided)) voidedMatchIds.add(row.id);
  }

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
    players: { name: string; side: string; captain: boolean; bench?: boolean; points: number; runs: number; wickets: number; catches: number; runouts: number; stumpings: number }[];
  };

  let yourCumulative = 0;
  let oppCumulative = 0;
  const allPart2 = [yourName, opponentName];
  const matchStats: MatchStatRow[] = (matches ?? []).map((m: any) => {
    const mp = playersByMatch[m.id] ?? [];
    const voided = voidedMatchIds.has(m.id);
    const yourPlayers = mp.filter((p) => p.side === player1Side);
    const oppPlayers = mp.filter((p) => p.side !== player1Side);
    const yourPtsRaw = yourPlayers.reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
    const oppPtsRaw = oppPlayers.reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
    const lateMeta = matchLineupForCompetition(m, competitionId);
    const latenessOpts2 = { voided, allParticipantNames: allPart2 };
    const yourAdj = voided ? 0 : lineupLatenessSideAdjustment(lateMeta, yourName, latenessOpts2);
    const oppAdj = voided ? 0 : lineupLatenessSideAdjustment(lateMeta, opponentName, latenessOpts2);
    const yourPts = voided ? 0 : yourPtsRaw + yourAdj;
    const oppPts = voided ? 0 : oppPtsRaw + oppAdj;
    yourCumulative += yourPts;
    oppCumulative += oppPts;

    const winner =
      voided
        ? null
        : yourPts > oppPts
          ? yourName
          : oppPts > yourPts
            ? opponentName
            : (yourPts !== 0 || oppPts !== 0)
              ? "Tie"
              : null;
    const players = mp.map((p) => ({
      name: p.name,
      side: p.side as "You" | string,
      captain: p.captain,
      bench: isFantasyBench(p as FantasyPlayer),
      points: voided ? 0 : fantasyPointsCounted(p, rules),
      runs: voided ? 0 : p.runs,
      wickets: voided ? 0 : p.wickets,
      catches: voided ? 0 : p.catches,
      runouts: voided ? 0 : p.runouts ?? 0,
      stumpings: voided ? 0 : p.stumpings ?? 0,
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
      hasData: !voided && (yourPts !== 0 || oppPts !== 0 || yourPtsRaw > 0 || oppPtsRaw > 0),
      isCurrent: Boolean(m.is_current),
      players,
    };
  });

  const leaderMap: Record<string, { name: string; side: string; totalPoints: number; matches: number; runs: number; wickets: number; catches: number; runouts: number; stumpings: number }> = {};
  for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
    const mid = (p as { match_id?: number }).match_id;
    if (typeof mid === "number" && voidedMatchIds.has(mid)) continue;
    const key = `${p.side}::${p.name}`;
    if (!leaderMap[key]) leaderMap[key] = { name: p.name, side: p.side, totalPoints: 0, matches: 0, runs: 0, wickets: 0, catches: 0, runouts: 0, stumpings: 0 };
    leaderMap[key].totalPoints += fantasyPointsCounted(p, rules);
    leaderMap[key].matches += 1;
    leaderMap[key].runs += p.runs;
    leaderMap[key].wickets += p.wickets;
    leaderMap[key].catches += p.catches;
    leaderMap[key].runouts += p.runouts ?? 0;
    leaderMap[key].stumpings += p.stumpings ?? 0;
  }

  const leaderboard = Object.values(leaderMap).sort((a, b) => b.totalPoints - a.totalPoints);
  const yourWins = matchStats.filter((m) => m.winner === yourName).length;
  const oppWins = matchStats.filter((m) => m.winner === opponentName).length;
  const ties = matchStats.filter((m) => m.winner === "Tie").length;

  // Multi-player: per-match points for each participant
  const participantMatchStats = isMultiPlayer
    ? (matches ?? []).map((m: any) => {
        const mp = playersByMatch[m.id] ?? [];
        const voided = voidedMatchIds.has(m.id);
        const pts: Record<string, number> = {};
        const runs: Record<string, number> = {};
        const wickets: Record<string, number> = {};
        const catches: Record<string, number> = {};
        const runouts: Record<string, number> = {};
        const stumpings: Record<string, number> = {};
        const captainPts: Record<string, number> = {};
        const captainName: Record<string, string> = {};
        const lateMetaM = matchLineupForCompetition(m, competitionId);
        const latenessOptsM = { voided, allParticipantNames: compPlayers };
        for (const name of compPlayers) {
          const sidePlayers = mp.filter((p: any) => p.side === name);
          const rawP = voided ? 0 : sidePlayers.reduce((s: number, p: any) => s + fantasyPointsCounted(p, rules), 0);
          pts[name] = rawP + (voided ? 0 : lineupLatenessSideAdjustment(lateMetaM, name, latenessOptsM));
          runs[name] = voided ? 0 : sidePlayers.reduce((s: number, p: any) => s + (p.runs ?? 0), 0);
          wickets[name] = voided ? 0 : sidePlayers.reduce((s: number, p: any) => s + (p.wickets ?? 0), 0);
          catches[name] = voided ? 0 : sidePlayers.reduce((s: number, p: any) => s + (p.catches ?? 0), 0);
          runouts[name] = voided ? 0 : sidePlayers.reduce((s: number, p: any) => s + (p.runouts ?? 0), 0);
          stumpings[name] = voided ? 0 : sidePlayers.reduce((s: number, p: any) => s + (p.stumpings ?? 0), 0);
          const cap = sidePlayers.find((p: any) => p.captain && !isFantasyBench(p));
          captainPts[name] = voided || !cap ? 0 : fantasyPointsCounted(cap, rules);
          captainName[name] = cap?.name ?? "—";
        }
        const hasData = !voided && Object.values(pts).some((v) => v !== 0);
        const maxPts = Math.max(...Object.values(pts), 0);
        const leaders = compPlayers.filter((n) => pts[n] === maxPts && maxPts > 0);
        const winner = voided ? null : leaders.length === 1 ? leaders[0] : (hasData ? "Tie" : null);
        return {
          matchId: m.id as number,
          fixture: formatFixture(m.fixture) || m.fixture || "TBD",
          date: (m.match_date ?? "") as string,
          pts,
          runs,
          wickets,
          catches,
          runouts,
          stumpings,
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
  const nextFixture = nextMatchRow?.fixture as string | undefined;
  let nextDate = nextMatchRow?.match_date as string | undefined;
  const nextVenue = (nextMatchRow as { venue?: string | null } | null)?.venue ?? null;

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
        <SeriesStandingsHero participants={data.participantTotals} nextMatch={data.nextMatch} />
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
        />
      ) : (
        <StatsClient
          yourName={data.yourName}
          opponentName={data.opponentName}
          youSide={competitionId != null ? data.yourName : "You"}
          matchStats={data.matchStats}
          leaderboard={data.leaderboard}
          summary={data.summary}
        />
      )}
    </main>
  );
}
