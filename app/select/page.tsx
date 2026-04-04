export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer } from "@/lib/scoring";
import NavBar from "@/components/NavBar";
import SelectClient from "@/components/SelectClient";

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

async function getData() {
  const [{ data: matches }, { data: settings }, { data: players }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true }),
  ]);

  // Prefer the explicitly-marked current match; if none (e.g. is_current column
  // missing from DB), fall back to highest id to at least show the latest match.
  const allMatches = matches ?? [];
  const currentMatch = allMatches.find((m: any) => m.is_current) ?? allMatches[0] ?? null;
  const matchPlayers = ((players ?? []) as FantasyPlayer[]).filter((p) => p.match_id === currentMatch?.id);

  return { currentMatch, matchPlayers, settings };
}

export default async function SelectPage() {
  const { currentMatch, matchPlayers, settings } = await getData();
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
    <main className="page-main">
      <NavBar title="Select Teams" subtitle={currentMatch?.fixture ? `Linked: ${currentMatch.fixture}` : "No match linked yet"} />
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
