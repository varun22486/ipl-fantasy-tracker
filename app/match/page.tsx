export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer } from "@/lib/scoring";
import NavBar from "@/components/NavBar";
import MatchClient from "@/components/MatchClient";

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

  const subtitle = currentMatch?.fixture
    ? currentMatch.fixture
    : "No match linked";

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <NavBar title="Live Match" subtitle={subtitle} />
      <MatchClient
        yourName={yourName}
        opponentName={opponentName}
        yourFantasyPlayers={yourPlayers}
        opponentFantasyPlayers={oppPlayers}
        currentMatch={currentMatchData}
        hasLinkedMatch={Boolean(currentMatch)}
        yourLineupSaved={yourPlayers.length > 0}
        opponentLineupSaved={oppPlayers.length > 0}
      />
    </main>
  );
}
