export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, sortFantasyLineupForDisplay } from "@/lib/scoring";
import { resolveCompetitionId } from "@/lib/competition";
import NavBar from "@/components/NavBar";
import SelectClient from "@/components/SelectClient";
import MatchActiveTabs from "@/components/MatchActiveTabs";
import { pickTrackedMatchRowFromList } from "@/lib/active-match";

type SquadTeam = { teamName: string; players: string[] };

function parseRosterFromMatch(match: unknown): { rosterNames: string[]; squads: SquadTeam[]; nameToId: Record<string, string> } {
  if (!match || typeof match !== "object") return { rosterNames: [], squads: [], nameToId: {} };
  const raw = (match as { provider_squad_json?: unknown }).provider_squad_json;
  if (!raw || typeof raw !== "object") return { rosterNames: [], squads: [], nameToId: {} };
  const o = raw as { squads?: unknown; rosterNames?: unknown; nameToId?: unknown };
  const squads = Array.isArray(o.squads)
    ? o.squads
        .filter((t): t is { teamName?: string; players?: unknown } => Boolean(t && typeof t === "object"))
        .map((t) => ({
          teamName: typeof t.teamName === "string" ? t.teamName : "Team",
          players: Array.isArray(t.players) ? t.players.filter((p): p is string => typeof p === "string" && Boolean(p.trim())) : [],
        }))
        .filter((t) => t.players.length > 0)
    : [];
  let rosterNames = Array.isArray(o.rosterNames)
    ? o.rosterNames.filter((n): n is string => typeof n === "string" && Boolean(n.trim()))
    : [];
  if (rosterNames.length === 0 && squads.length > 0) {
    const s = new Set<string>();
    for (const t of squads) for (const p of t.players) s.add(p.trim());
    rosterNames = [...s].sort((a, b) => a.localeCompare(b));
  }
  const nameToId: Record<string, string> =
    o.nameToId && typeof o.nameToId === "object" && !Array.isArray(o.nameToId)
      ? (o.nameToId as Record<string, string>)
      : {};
  return { rosterNames, squads, nameToId };
}

async function getData(queryM: string | undefined) {
  const [{ data: matches }, { data: settings }, { data: players }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true }),
  ]);

  const list = matches ?? [];
  const { activeTrackedForTabs, shownRow, activeTabsScope } = pickTrackedMatchRowFromList(
    list as {
      id: number;
      is_current?: boolean;
      match_date?: string | null;
      fixture?: string | null;
      status?: string | null;
    }[],
    queryM
  );
  const currentMatch = shownRow as (typeof list)[number] | null;
  const matchPlayers = ((players ?? []) as FantasyPlayer[]).filter((p) => p.match_id === currentMatch?.id);

  return { currentMatch, matchPlayers, settings, activeTrackedForTabs, activeTabsScope };
}

export default async function SelectPage({ searchParams }: { searchParams: Promise<{ m?: string; c?: string }> }) {
  const { m, c } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const { currentMatch, matchPlayers, settings, activeTrackedForTabs, activeTabsScope } = await getData(m);
  const { rosterNames, squads, nameToId } = parseRosterFromMatch(currentMatch);

  let yourName: string;
  let opponentName: string;
  let compPlayers: string[] = [];
  if (competitionId != null) {
    const { data: comp } = await supabaseAdmin.from("competitions").select("*").eq("id", competitionId).single();
    compPlayers = Array.isArray(comp?.players) ? comp.players : [comp?.player1_name ?? "Player 1", comp?.player2_name ?? "Player 2"];
    yourName = compPlayers[0] ?? "Player 1";
    opponentName = compPlayers[1] ?? "Player 2";
  } else {
    opponentName = settings?.opponent_name ?? "Rahul";
    yourName = (settings as { your_name?: string })?.your_name ?? "Varun";
  }

  const isCompFilter = (p: FantasyPlayer) =>
    competitionId != null
      ? (p as FantasyPlayer & { competition_id?: number | null }).competition_id === competitionId
      : (p as FantasyPlayer & { competition_id?: number | null }).competition_id == null;

  const p1Side = competitionId != null ? yourName : "You";
  const yourPlayersSorted = sortFantasyLineupForDisplay(
    matchPlayers.filter((p) => p.side === p1Side && isCompFilter(p)),
  );
  const oppPlayersSorted = sortFantasyLineupForDisplay(
    matchPlayers.filter((p) => p.side !== p1Side && isCompFilter(p)),
  );

  const mapRow = (p: FantasyPlayer) => ({
    name: p.name,
    captain: p.captain,
    bench: p.bench,
    provider_player_id: p.provider_player_id ?? null,
  });

  const yourPlayers = yourPlayersSorted.map(mapRow);
  const oppPlayers = oppPlayersSorted.map(mapRow);

  const existingPicks =
    compPlayers.length >= 3
      ? compPlayers.map((name) =>
          sortFantasyLineupForDisplay(matchPlayers.filter((p) => p.side === name && isCompFilter(p))).map(mapRow),
        )
      : undefined;

  const isMultiSubtitle = compPlayers.length > 2;
  const competitionSuffix =
    competitionId != null ? `&c=${encodeURIComponent(String(competitionId))}` : "";

  return (
    <main className="page-main page-main--select">
      <NavBar
        title="Lineup studio"
        subtitle={
          currentMatch?.fixture
            ? isMultiSubtitle
              ? `${currentMatch.fixture} — complete every lineup to enter the match view`
              : `${currentMatch.fixture} — complete both squads to enter the match view`
            : "Link a fixture, load the squad, then build and save each lineup"
        }
      />
      <MatchActiveTabs
        matches={activeTrackedForTabs as { id: number; fixture?: string | null }[]}
        selectedId={currentMatch?.id ?? 0}
        basePath="/select"
        competitionSuffix={competitionSuffix}
        scope={activeTabsScope}
      />
      <SelectClient
        yourName={yourName}
        opponentName={opponentName}
        yourPlayers={yourPlayers}
        opponentPlayers={oppPlayers}
        rosterNames={rosterNames}
        squads={squads}
        nameToId={nameToId}
        hasLinkedMatch={Boolean(currentMatch)}
        matchId={currentMatch?.id ?? null}
        competitionId={competitionId}
        compPlayers={compPlayers.length >= 3 ? compPlayers : undefined}
        existingPicks={existingPicks}
      />
    </main>
  );
}
