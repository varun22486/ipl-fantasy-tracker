export const dynamic = "force-dynamic";
import { resolveCompetitionId } from "@/lib/competition";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, sortFantasyLineupForDisplay } from "@/lib/scoring";
import NavBar from "@/components/NavBar";
import MatchClient from "@/components/MatchClient";
import MatchActiveTabs from "@/components/MatchActiveTabs";
import { readActiveMatchCookieValue, pickTrackedMatchRowFromList } from "@/lib/active-match";

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

async function getData(queryM: string | undefined, cookieVal: string | undefined) {
  const [{ data: matches }, { data: settings }, { data: players }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true }),
  ]);

  const list = matches ?? [];
  const { activeTrackedForTabs, shownRow } = pickTrackedMatchRowFromList(
    list as {
      id: number;
      is_current?: boolean;
      match_date?: string | null;
      fixture?: string | null;
      status?: string | null;
    }[],
    queryM,
    cookieVal
  );
  const currentMatch = shownRow as (typeof list)[number] | null;
  const matchPlayers = ((players ?? []) as FantasyPlayer[]).filter((p) => p.match_id === currentMatch?.id);

  return { currentMatch, matchPlayers, settings, activeTrackedForTabs };
}

export default async function MatchPage({ searchParams }: { searchParams: Promise<{ c?: string; m?: string }> }) {
  const { c, m } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const cookieVal = await readActiveMatchCookieValue();
  const { currentMatch, matchPlayers, settings, activeTrackedForTabs } = await getData(m, cookieVal);

  let yourName: string;
  let opponentName: string;
  let compPlayers: string[] = [];
  if (competitionId != null) {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { data: comp } = await supabaseAdmin
      .from("competitions").select("*").eq("id", competitionId).single();
    compPlayers = Array.isArray(comp?.players) ? comp.players : [comp?.player1_name ?? "Player 1", comp?.player2_name ?? "Player 2"];
    yourName = compPlayers[0] ?? "Player 1";
    opponentName = compPlayers[1] ?? "Player 2";
  } else {
    yourName = (settings as any)?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  const isCompFilter = (p: FantasyPlayer) =>
    competitionId != null
      ? (p as any).competition_id === competitionId
      : (p as any).competition_id == null;

  const p1Side = competitionId != null ? yourName : "You";
  const yourPlayers = sortFantasyLineupForDisplay(matchPlayers.filter((p) => p.side === p1Side && isCompFilter(p)));
  const oppPlayers = sortFantasyLineupForDisplay(matchPlayers.filter((p) => p.side !== p1Side && isCompFilter(p)));

  // For multi-player competitions, collect all participants' picks
  const allParticipantPlayers = compPlayers.length > 2
    ? compPlayers.map((name) => ({
        name,
        players: sortFantasyLineupForDisplay(matchPlayers.filter((p) => p.side === name && isCompFilter(p))),
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

  const subtitle = !currentMatch
    ? "No match linked"
    : !yourLineupSaved && !oppLineupSaved
    ? `${currentMatch.fixture} — pick your teams to start`
    : currentMatch.fixture;

  const competitionSuffix = competitionId != null ? `&c=${encodeURIComponent(String(competitionId))}` : "";
  const selectedTabId = currentMatch?.id ?? 0;

  return (
    <main className="page-main">
      <NavBar title="Match" subtitle={subtitle} />
      <MatchActiveTabs
        matches={activeTrackedForTabs as { id: number; fixture?: string | null }[]}
        selectedId={selectedTabId}
        basePath="/match"
        competitionSuffix={competitionSuffix}
      />
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
      />
    </main>
  );
}
