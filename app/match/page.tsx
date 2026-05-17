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
import { pickTrackedMatchRowWithLineupPreference, sameNumericId } from "@/lib/active-match";
import { isAppUsingCricapiProvider } from "@/lib/cricket-provider";
import { fetchFantasyPickCountsByCompetition } from "@/lib/fantasy-pick-counts";
import {
  competitionParticipantList,
  fantasyRowMatchesCompetition,
  fantasySideEquals,
  fantasySideMatchesParticipant,
  type CompetitionRow,
} from "@/lib/competition-participants";

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

async function getData(queryM: string | undefined, competitionId: number | null) {
  const [{ data: matches }, { data: settings }, { data: players }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true }),
  ]);

  const list = matches ?? [];
  const lineupMatchIds = new Set<number>();
  for (const p of (players ?? []) as FantasyPlayer[]) {
    if (fantasyRowMatchesCompetition((p as FantasyPlayer & { competition_id?: number | null }).competition_id, competitionId)) {
      lineupMatchIds.add(Number((p as { match_id: unknown }).match_id));
    }
  }

  const { activeTrackedForTabs, shownRow, activeTabsScope } = pickTrackedMatchRowWithLineupPreference(
    list as {
      id: number;
      is_current?: boolean;
      match_date?: string | null;
      fixture?: string | null;
      status?: string | null;
    }[],
    queryM,
    lineupMatchIds
  );
  const currentMatch = shownRow as (typeof list)[number] | null;
  const matchPlayers = ((players ?? []) as FantasyPlayer[]).filter((p) =>
    sameNumericId(p.match_id, currentMatch?.id),
  );

  return { currentMatch, matchPlayers, settings, activeTrackedForTabs, activeTabsScope };
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
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { data: comp } = await supabaseAdmin
      .from("competitions").select("*").eq("id", competitionId).single();
    compRow = comp as CompetitionRow | null;
    compPlayers = competitionParticipantList(comp);
    yourName = compPlayers[0] ?? "Player 1";
    opponentName = compPlayers[1] ?? "Player 2";
  } else {
    yourName = (settings as any)?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  const isCompFilter = (p: FantasyPlayer) =>
    fantasyRowMatchesCompetition((p as FantasyPlayer & { competition_id?: number | null }).competition_id, competitionId);

  const sideMatches = (rowSide: unknown, label: string) =>
    competitionId != null
      ? fantasySideMatchesParticipant(rowSide, label, compRow)
      : fantasySideEquals(rowSide, label);

  const yourPlayers = sortFantasyLineupForDisplay(
    matchPlayers.filter((p) =>
      isCompFilter(p) && (competitionId != null ? sideMatches(p.side, yourName) : p.side === "You"),
    ),
  );
  const oppPlayers = sortFantasyLineupForDisplay(
    matchPlayers.filter((p) =>
      isCompFilter(p) && (competitionId != null ? sideMatches(p.side, opponentName) : p.side !== "You"),
    ),
  );

  // For multi-player competitions, collect all participants' picks
  const allParticipantPlayers = compPlayers.length > 2
    ? compPlayers.map((name) => ({
        name,
        players: sortFantasyLineupForDisplay(
          matchPlayers.filter((p) => isCompFilter(p) && sideMatches(p.side, name)),
        ),
      }))
    : [];

  const { rosterNames, squads, nameToId } = parseRoster(currentMatch);

  const currentMatchData = currentMatch
    ? {
        fixture: currentMatch.fixture ?? undefined,
        label: currentMatch.label ?? undefined,
        status: currentMatch.status ?? undefined,
        venue: currentMatch.venue ?? null,
        toss_winner: currentMatch.toss_winner ?? null,
        live_summary: currentMatch.live_summary ?? null,
        last_synced_at: currentMatch.last_synced_at ?? null,
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
      : currentMatch.fixture;

  const competitionSuffix = competitionId != null ? `&c=${encodeURIComponent(String(competitionId))}` : "";
  const selectedTabId = currentMatch?.id ?? 0;

  const cricbuzzScoreSyncEnabled =
    isAppUsingCricapiProvider() &&
    Boolean(currentMatch && String((currentMatch as { fixture?: string | null }).fixture ?? "").trim()) &&
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
