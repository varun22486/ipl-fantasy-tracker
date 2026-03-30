export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer } from "@/lib/scoring";
import NavBar from "@/components/NavBar";
import SelectClient from "@/components/SelectClient";

type SquadTeam = { teamName: string; players: string[] };

function parseRosterFromMatch(match: unknown): { rosterNames: string[]; squads: SquadTeam[] } {
  if (!match || typeof match !== "object") return { rosterNames: [], squads: [] };
  const raw = (match as { provider_squad_json?: unknown }).provider_squad_json;
  if (!raw || typeof raw !== "object") return { rosterNames: [], squads: [] };
  const o = raw as { squads?: unknown; rosterNames?: unknown };
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
  return { rosterNames, squads };
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

export default async function SelectPage() {
  const { currentMatch, matchPlayers, settings } = await getData();
  const { rosterNames, squads } = parseRosterFromMatch(currentMatch);
  const opponentName = settings?.opponent_name ?? "Rahul";
  const yourPlayers = matchPlayers.filter((p) => p.side === "You").map((p) => ({ name: p.name, captain: p.captain }));
  const oppPlayers = matchPlayers.filter((p) => p.side !== "You").map((p) => ({ name: p.name, captain: p.captain }));

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <NavBar title="Select Teams" subtitle={currentMatch?.fixture ? `Linked: ${currentMatch.fixture}` : "No match linked yet"} />
      <SelectClient
        opponentName={opponentName}
        yourPlayers={yourPlayers}
        opponentPlayers={oppPlayers}
        rosterNames={rosterNames}
        squads={squads}
        hasLinkedMatch={Boolean(currentMatch)}
      />
    </main>
  );
}
