export const dynamic = "force-dynamic";
import { resolveCompetitionId } from "@/lib/competition";
export const revalidate = 0;

import { Suspense } from "react";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, sortFantasyLineupForDisplay } from "@/lib/scoring";
import { isPointsVoidedMatchStatus } from "@/lib/match-void";
import { hasLineupLatenessActive, matchLineupForCompetition, type MatchLineupLateness } from "@/lib/lineup-lateness";
import NavBar from "@/components/NavBar";
import MatchClient from "@/components/MatchClient";
import MatchActiveTabs from "@/components/MatchActiveTabs";
import { pickTrackedMatchRowWithLineupPreference } from "@/lib/active-match";
import { isAppUsingCricapiProvider } from "@/lib/cricket-provider";
import { fetchFantasyPickCountsByCompetition } from "@/lib/fantasy-pick-counts";
import {
  competitionParticipantList,
  fantasySideMatchesParticipant,
  type CompetitionRow,
} from "@/lib/competition-participants";
import {
  fetchMatchIdsWithLineups,
  fetchPlayersForMatch,
  findMatchInList,
  parseExplicitMatchId,
  pickMatchRowWithLineups,
  splitH2hLineup,
} from "@/lib/match-fantasy-load";

type SquadTeam = { teamName: string; players: string[] };

function parseRoster(match: unknown): { rosterNames: string[]; squads: SquadTeam[]; nameToId: Record<string, string> } {
  if (!match || typeof match !== "object") return { rosterNames: [], squads: [], nameToId: {} };
  const raw = (match as { provider_squad_json?: unknown }).provider_squad_json;
  if (!raw || typeof raw !== "object") return { rosterNames: [], squads: [], nameToId: {} };
  const o = raw as { squads?: unknown; rosterNames?: unknown; nameToId?: unknown };
  const squads = Array.isArray(o.squads)
    ? (o.squads as any[]).filter((t) => t && typeof t === "object")
        .map((t) => ({ teamName: typeof t.teamName === "string" ? t.teamName : "Team", players: Array.isArray(t.players) ? t.players.filter((p: any) => typeof p === "string" && p.trim()) : [] }))
        .filter((t) => t.players.length > 0)
    : [];
  let rosterNames = Array.isArray(o.rosterNames) ? o.rosterNames.filter((n: any) => typeof n === "string" && n.trim()) : [];
  if (rosterNames.length === 0 && squads.length > 0) {
    const s = new Set<string>();
    for (const t of squads) for (const p of t.players) s.add(p.trim());
    rosterNames = [...s].sort((a, b) => a.localeCompare(b));
  }
  const nameToId = o.nameToId && typeof o.nameToId === "object" && !Array.isArray(o.nameToId) ? (o.nameToId as Record<string, string>) : {};
  return { rosterNames, squads, nameToId };
}

type MatchListRow = {
  id: number;
  is_current?: boolean;
  match_date?: string | null;
  fixture?: string | null;
  status?: string | null;
};

async function getData(queryM: string | undefined, competitionId: number | null) {
  const [{ data: matches }, { data: settings }, lineupMatchIds] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    fetchMatchIdsWithLineups(competitionId),
  ]);

  const list = (matches ?? []) as MatchListRow[];
  const explicitId = parseExplicitMatchId(queryM);
  const tabPick = pickTrackedMatchRowWithLineupPreference(list, queryM, lineupMatchIds);

  let currentMatch: MatchListRow | null = null;
  if (explicitId != null) {
    currentMatch = findMatchInList(list, explicitId) ?? tabPick.shownRow;
  } else {
    currentMatch = tabPick.shownRow;
  }
  currentMatch = pickMatchRowWithLineups(list, currentMatch, lineupMatchIds);

  const matchIdNum = Number(currentMatch?.id);
  const rawPlayers =
    Number.isFinite(matchIdNum) && matchIdNum > 0
      ? await fetchPlayersForMatch(matchIdNum, competitionId)
      : [];

  return {
    currentMatch,
    matchPlayers: rawPlayers,
    settings,
    activeTrackedForTabs: tabPick.activeTrackedForTabs,
    activeTabsScope: tabPick.activeTabsScope,
  };
}

export default async function MatchPage({ searchParams }: { searchParams: Promise<{ c?: string; m?: string }> }) {
  const { c, m } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const { currentMatch, matchPlayers, settings, activeTrackedForTabs, activeTabsScope } = await getData(m, competitionId);

  let yourName: string;
  let opponentName: string;
  let compPlayers: string[] = [];
  let compRow: CompetitionRow | null = null;
  if (competitionId != null) {
    const { data: comp } = await supabaseAdmin.from("competitions").select("*").eq("id", competitionId).single();
    compRow = comp as CompetitionRow | null;
    compPlayers = competitionParticipantList(comp);
    yourName = compPlayers[0] ?? "Player 1";
    opponentName = compPlayers[1] ?? "Player 2";
  } else {
    yourName = (settings as { your_name?: string })?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  const sideMatches = (rowSide: unknown, label: string) =>
    competitionId != null ? fantasySideMatchesParticipant(rowSide, label, compRow) : String(rowSide) === label;

  const { your: yourRaw, opp: oppRaw } = splitH2hLineup(
    matchPlayers as FantasyPlayer[],
    yourName,
    opponentName,
    competitionId,
    compRow
  );

  const yourPlayers = sortFantasyLineupForDisplay(yourRaw);
  const oppPlayers = sortFantasyLineupForDisplay(oppRaw);

  const allParticipantPlayers =
    compPlayers.length > 2
      ? compPlayers.map((name) => ({
          name,
          players: sortFantasyLineupForDisplay(
            matchPlayers.filter((p) => sideMatches((p as FantasyPlayer).side, name))
          ),
        }))
      : [];

  const { rosterNames, squads, nameToId } = parseRoster(currentMatch);

  const currentMatchData = currentMatch
    ? {
        fixture: currentMatch.fixture ?? undefined,
        label: (currentMatch as { label?: string }).label ?? undefined,
        status: currentMatch.status ?? undefined,
        venue: (currentMatch as { venue?: string | null }).venue ?? null,
        toss_winner: (currentMatch as { toss_winner?: string | null }).toss_winner ?? null,
        live_summary: (currentMatch as { live_summary?: string | null }).live_summary ?? null,
        last_synced_at: (currentMatch as { last_synced_at?: string | null }).last_synced_at ?? null,
      }
    : null;

  const yourLineupSaved = yourPlayers.length > 0;
  const oppLineupSaved = oppPlayers.length > 0;

  const matchRow = currentMatch as
    | ({
        status?: string | null;
        live_summary?: string | null;
        fantasy_voided?: boolean | null;
        lineup_lateness_enabled?: boolean | null;
        lineup_late_participant?: string | null;
        lineup_late_participants?: string[] | null;
        lineup_lateness_points?: number | null;
        lineup_lateness_by_comp?: unknown;
      } & typeof currentMatch)
    | null;
  const pointsVoided = matchRow
    ? isPointsVoidedMatchStatus(matchRow.status, matchRow.live_summary, matchRow.fantasy_voided)
    : true;
  const lineupLatenessInput: MatchLineupLateness | null = matchRow
    ? matchLineupForCompetition(matchRow, competitionId)
    : null;
  const lineupLatenessActive = Boolean(
    lineupLatenessInput && hasLineupLatenessActive(lineupLatenessInput, pointsVoided)
  );

  const nobodySavedBoth =
    compPlayers.length > 2
      ? allParticipantPlayers.length === 0 || allParticipantPlayers.every((b) => b.players.length === 0)
      : !yourLineupSaved && !oppLineupSaved;

  const subtitle = !currentMatch
    ? "No match linked"
    : nobodySavedBoth && !lineupLatenessActive
      ? `${String(currentMatch.fixture)} — pick your teams to start`
      : String(currentMatch.fixture ?? "");

  const competitionSuffix = competitionId != null ? `&c=${encodeURIComponent(String(competitionId))}` : "";
  const selectedTabId = Number(currentMatch?.id) || 0;

  const cricbuzzScoreSyncEnabled =
    isAppUsingCricapiProvider() &&
    Boolean(currentMatch && String(currentMatch.fixture ?? "").trim()) &&
    !pointsVoided;

  const pickCounts = await fetchFantasyPickCountsByCompetition(competitionId);

  return (
    <main className="page-main">
      <NavBar title="Match" subtitle={subtitle} />
      <MatchActiveTabs
        matches={activeTrackedForTabs as { id: number; fixture?: string | null }[]}
        selectedId={selectedTabId}
        basePath="/match"
        competitionSuffix={competitionSuffix}
        scope={activeTabsScope}
      />
      <Suspense fallback={null}>
        <MatchClient
          key={`${selectedTabId}-${yourPlayers.length}-${oppPlayers.length}-${competitionId ?? "d"}`}
          yourName={yourName}
          opponentName={opponentName}
          yourFantasyPlayers={yourPlayers}
          opponentFantasyPlayers={oppPlayers}
          matchId={currentMatch?.id ?? null}
          currentMatch={currentMatchData}
          hasLinkedMatch={Boolean(currentMatch)}
          yourLineupSaved={yourLineupSaved}
          opponentLineupSaved={oppLineupSaved}
          rosterNames={rosterNames}
          squads={squads}
          nameToId={nameToId}
          existingYourPlayers={yourPlayers.map((p) => ({
            name: p.name,
            captain: p.captain,
            bench: p.bench,
            provider_player_id: (p as FantasyPlayer).provider_player_id ?? null,
          }))}
          existingOppPlayers={oppPlayers.map((p) => ({
            name: p.name,
            captain: p.captain,
            bench: p.bench,
            provider_player_id: (p as FantasyPlayer).provider_player_id ?? null,
          }))}
          competitionId={competitionId}
          allParticipants={allParticipantPlayers}
          pointsVoided={pointsVoided}
          lineupLatenessMeta={lineupLatenessInput}
          lineupLatenessActive={lineupLatenessActive}
          cricbuzzScoreSyncEnabled={cricbuzzScoreSyncEnabled}
          rosterPickCounts={pickCounts}
        />
      </Suspense>
    </main>
  );
}
