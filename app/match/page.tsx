export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer } from "@/lib/scoring";
import NavBar from "@/components/NavBar";
import MatchClient from "@/components/MatchClient";

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

async function getData() {
  const [{ data: matches }, { data: settings }, { data: players }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true }),
  ]);

  const currentMatch = (matches ?? []).find((m: any) => m.is_current) ?? matches?.[0] ?? null;
  const matchPlayers = ((players ?? []) as FantasyPlayer[]).filter((p) => p.match_id === currentMatch?.id);

  return { currentMatch, matchPlayers, settings };
}

export default async function MatchPage() {
  const { currentMatch, matchPlayers, settings } = await getData();
  const opponentName = settings?.opponent_name ?? "Rahul";
  const yourName = (settings as any)?.your_name ?? "Varun";
  const yourPlayers = matchPlayers.filter((p) => p.side === "You");
  const oppPlayers = matchPlayers.filter((p) => p.side !== "You");

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

  return (
    <main className="page-main">
      <NavBar title="Match" subtitle={subtitle} />
      <MatchClient
        yourName={yourName}
        opponentName={opponentName}
        yourFantasyPlayers={yourPlayers}
        opponentFantasyPlayers={oppPlayers}
        currentMatch={currentMatchData}
        hasLinkedMatch={Boolean(currentMatch)}
        yourLineupSaved={yourLineupSaved}
        opponentLineupSaved={oppLineupSaved}
        rosterNames={rosterNames}
        squads={squads}
        nameToId={nameToId}
        existingYourPlayers={yourPlayers.map((p) => ({ name: p.name, captain: p.captain }))}
        existingOppPlayers={oppPlayers.map((p) => ({ name: p.name, captain: p.captain }))}
      />
    </main>
  );
}
