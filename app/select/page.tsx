export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer } from "@/lib/scoring";
import NavBar from "@/components/NavBar";
import SelectClient from "@/components/SelectClient";
import MatchActiveTabs from "@/components/MatchActiveTabs";
import { readActiveMatchCookieValue, pickTrackedMatchRowFromList } from "@/lib/active-match";

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

export default async function SelectPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const cookieVal = await readActiveMatchCookieValue();
  const { currentMatch, matchPlayers, settings, activeTrackedForTabs } = await getData(m, cookieVal);
  const { rosterNames, squads, nameToId } = parseRosterFromMatch(currentMatch);
  const opponentName = settings?.opponent_name ?? "Rahul";
  const yourName = (settings as any)?.your_name ?? "Varun";
  const yourPlayers = matchPlayers.filter((p) => p.side === "You").map((p) => ({
    name: p.name,
    captain: p.captain,
    bench: p.bench,
    provider_player_id: (p as FantasyPlayer).provider_player_id ?? null,
  }));
  const oppPlayers = matchPlayers.filter((p) => p.side !== "You").map((p) => ({
    name: p.name,
    captain: p.captain,
    bench: p.bench,
    provider_player_id: (p as FantasyPlayer).provider_player_id ?? null,
  }));

  return (
    <main className="page-main page-main--select">
      <NavBar
        title="Select Teams"
        subtitle={
          currentMatch?.fixture
            ? `${currentMatch.fixture} · Save both lineups to open the match`
            : "Link a match, then save each side's team to continue"
        }
      />
      <MatchActiveTabs
        matches={activeTrackedForTabs as { id: number; fixture?: string | null }[]}
        selectedId={currentMatch?.id ?? 0}
        basePath="/select"
        competitionSuffix=""
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
      />
    </main>
  );
}
