import DashboardClient from "@/components/DashboardClient";
import ScoreCard from "@/components/ScoreCard";
import PlayerTable from "@/components/PlayerTable";
import { supabase } from "@/lib/supabase";
import { FantasyPlayer, teamPoints } from "@/lib/scoring";
import SetCurrentButton from "@/components/SetCurrentButton";

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
  const [{ data: matches }, { data: settings }] = await Promise.all([
    supabase.from("matches").select("*").order("id", { ascending: false }),
    supabase.from("series_settings").select("*").limit(1).single(),
  ]);

  // Prefer the explicitly-marked current match; fall back to most recently linked
  const currentMatch = (matches ?? []).find((m: any) => m.is_current) ?? matches?.[0] ?? null;
  let players: FantasyPlayer[] = [];

  if (currentMatch) {
    const result = await supabase
      .from("fantasy_players")
      .select("*")
      .eq("match_id", currentMatch.id)
      .order("id", { ascending: true });
    players = (result.data ?? []) as FantasyPlayer[];
  }

  return { matches: matches ?? [], currentMatch, players, settings };
}

export default async function Home() {
  const { matches, currentMatch, players, settings } = await getData();
  const { rosterNames, squads } = parseRosterFromMatch(currentMatch);
  const yourPlayers = players.filter((p) => p.side === "You");
  const rahulPlayers = players.filter((p) => p.side === "Rahul");

  const yourTotal = teamPoints(yourPlayers);
  const rahulTotal = teamPoints(rahulPlayers);
  const opponentName = settings?.opponent_name ?? "Rahul";
  const leader =
    yourTotal === rahulTotal ? "Tie" : yourTotal > rahulTotal ? `You +${yourTotal - rahulTotal}` : `${opponentName} +${rahulTotal - yourTotal}`;

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ color: "#64748b", fontSize: 14 }}>IPL Fantasy Tracker</div>
        <h1 style={{ margin: "8px 0 4px", fontSize: 36 }}>You vs {opponentName}</h1>
        <div style={{ color: "#475569" }}>Pick 4 players each, mark 1 as Team Captain each, and let the dashboard sync the live score automatically.</div>
      </div>

      <DashboardClient
        opponentName={opponentName}
        yourPlayers={yourPlayers.map((p) => ({ name: p.name, captain: p.captain }))}
        opponentPlayers={rahulPlayers.map((p) => ({ name: p.name, captain: p.captain }))}
        rosterNames={rosterNames}
        squads={squads}
        hasLinkedMatch={Boolean(currentMatch)}
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 16, marginBottom: 24 }}>
        <ScoreCard label="Current Match" value={currentMatch?.fixture ?? currentMatch?.label ?? "None"} />
        <ScoreCard label="Status" value={currentMatch?.status ?? "-"} />
        <ScoreCard label="Your Points" value={yourTotal} />
        <ScoreCard label={`${opponentName} Points`} value={rahulTotal} />
      </div>

      <div style={{ marginBottom: 24 }}>
        <ScoreCard label="Leader" value={leader} />
      </div>

      {currentMatch ? (
        <>
          <div style={{ marginBottom: 16, color: "#475569" }}>
            <strong>{currentMatch.fixture}</strong>
            {currentMatch.venue ? ` · ${currentMatch.venue}` : ""}
            {currentMatch.toss_winner ? ` · Toss: ${currentMatch.toss_winner}` : ""}
            {currentMatch.live_summary ? ` · ${currentMatch.live_summary}` : ""}
          </div>
          <div style={{ marginBottom: 16, color: "#64748b", fontSize: 14 }}>
            Last synced: {currentMatch.last_synced_at ? new Date(currentMatch.last_synced_at).toLocaleString() : "Not yet"}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
            <PlayerTable title="Your Team" players={yourPlayers} />
            <PlayerTable title={`${opponentName} Team`} players={rahulPlayers} />
          </div>
        </>
      ) : (
        <div style={{ color: "#64748b" }}>No match linked yet. Use &quot;Link IPL Match&quot; above first.</div>
      )}

      <div style={{ marginTop: 32 }}>
        <h2>Match Archive</h2>
        <div style={{ overflowX: "auto", background: "white", border: "1px solid #e2e8f0", borderRadius: 20, padding: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Match", "Status", "Venue", "Last Sync", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e2e8f0", color: "#475569", fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matches.map((m: any) => (
                <tr key={m.id} style={{ background: m.is_current ? "#f0fdf4" : "transparent" }}>
                  <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>{m.match_date ?? "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{m.fixture}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{m.status}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{m.venue ?? "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{m.last_synced_at ? new Date(m.last_synced_at).toLocaleString() : "-"}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                    {m.is_current
                      ? <span style={{ fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✓ Current</span>
                      : <SetCurrentButton matchId={m.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
