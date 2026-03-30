export const dynamic = "force-dynamic";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, playerPoints, teamPoints } from "@/lib/scoring";
import { formatFixture } from "@/lib/format";
import NavBar from "@/components/NavBar";
import Link from "next/link";
import type { CSSProperties } from "react";

type PageProps = { params: Promise<{ id: string }> };

async function getData(matchId: number) {
  const [{ data: match }, { data: players }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").eq("id", matchId).single(),
    supabaseAdmin.from("fantasy_players").select("*").eq("match_id", matchId).order("id", { ascending: true }),
    supabaseAdmin.from("series_settings").select("opponent_name").limit(1).single(),
  ]);
  return { match, players: (players ?? []) as FantasyPlayer[], opponentName: settings?.opponent_name ?? "Rahul" };
}

function PlayerRow({ p, opponentName }: { p: FantasyPlayer; opponentName: string }) {
  const pts = playerPoints(p);
  const isYou = p.side === "You";
  return (
    <tr style={{ background: "white" }}>
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          {p.captain && <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6, background: "#fef9c3", color: "#92400e", fontWeight: 700 }}>★ Captain</span>}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          <span style={{ padding: "2px 6px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: isYou ? "#dbeafe" : "#fee2e2", color: isYou ? "#2563eb" : "#dc2626" }}>
            {isYou ? "You" : opponentName}
          </span>
        </div>
      </td>
      <td style={{ ...td, color: "#475569" }}>{p.runs}</td>
      <td style={{ ...td, color: "#475569" }}>{p.wickets}</td>
      <td style={{ ...td, color: "#475569" }}>{p.catches}</td>
      <td style={{ ...td, color: "#64748b", fontSize: 13 }}>
        {pts.base > 0 && <div>Bat: {pts.base}</div>}
        {pts.wicketBonus > 0 && <div>Wkt: {pts.wicketBonus}</div>}
        {pts.catchBonus > 0 && <div>Catch: {pts.catchBonus}</div>}
        {pts.captainBonus > 0 && <div>Cap: ×2</div>}
      </td>
      <td style={{ ...td, fontWeight: 800, fontSize: 18, color: "#0f172a" }}>{pts.final}</td>
    </tr>
  );
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { id } = await params;
  const matchId = parseInt(id, 10);
  if (isNaN(matchId)) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <NavBar title="Match Not Found" />
        <p>Invalid match ID.</p>
      </main>
    );
  }

  const { match, players, opponentName } = await getData(matchId);

  if (!match) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <NavBar title="Match Not Found" />
        <p style={{ color: "#64748b" }}>No match found with ID {matchId}.</p>
        <Link href="/" style={linkBack}>← Back to Series</Link>
      </main>
    );
  }

  const yourPlayers = players.filter((p) => p.side === "You");
  const oppPlayers = players.filter((p) => p.side !== "You");
  const yourTotal = teamPoints(yourPlayers);
  const oppTotal = teamPoints(oppPlayers);
  const hasData = yourTotal > 0 || oppTotal > 0;

  const fixtureName = formatFixture(match.fixture) || match.fixture || "Match";
  const winner = !hasData ? null : yourTotal > oppTotal ? "You" : oppTotal > yourTotal ? opponentName : "Tie";
  const diff = Math.abs(yourTotal - oppTotal);
  const lastSynced = match.last_synced_at
    ? new Date(match.last_synced_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : null;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <NavBar title={fixtureName} subtitle={match.match_date ?? undefined} />

      {/* Match header */}
      <div style={{ display: "grid", gap: 20 }}>
        <div style={{ padding: "20px 24px", background: "white", border: "1px solid #e2e8f0", borderRadius: 20, display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, color: "#64748b" }}>{match.match_date}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: "#0f172a" }}>{fixtureName}</div>
            {match.venue && <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{match.venue}</div>}
            {match.toss_winner && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Toss: {match.toss_winner}</div>}
            {lastSynced && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>Last synced: {lastSynced}</div>}
          </div>
          <span style={{ padding: "4px 12px", borderRadius: 999, background: match.status === "LIVE" ? "#dcfce7" : "#f1f5f9", color: match.status === "LIVE" ? "#16a34a" : "#64748b", fontSize: 13, fontWeight: 600 }}>
            {match.status ?? "—"}
          </span>
        </div>

        {/* Score cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
          {[
            { label: "Your Points", value: hasData ? yourTotal : "—", color: "#2563eb" },
            { label: `${opponentName} Points`, value: hasData ? oppTotal : "—", color: "#dc2626" },
            { label: "Winner", value: winner ?? "No data", color: winner === "You" ? "#2563eb" : winner === opponentName ? "#dc2626" : "#92400e" },
            { label: "Points Diff", value: hasData ? `${diff} pts` : "—", color: "#0f172a" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ padding: "14px 18px", background: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>

        {!hasData ? (
          <div style={{ textAlign: "center", padding: 40, background: "white", border: "1px solid #e2e8f0", borderRadius: 16, color: "#64748b" }}>
            No player scores synced yet for this match.
            {match.is_current && (
              <><br /><br /><Link href="/match" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>→ Go to Live Match to sync scores</Link></>
            )}
          </div>
        ) : (
          <>
            {/* Your team */}
            <div style={section}>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#0f172a" }}>Your Team</h3>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>Total: <strong style={{ color: "#2563eb" }}>{yourTotal} pts</strong></div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Player", "Runs", "Wkts", "Ct", "Breakdown", "Points"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {yourPlayers.map((p) => <PlayerRow key={p.id} p={p} opponentName={opponentName} />)}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Opponent's team */}
            <div style={section}>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#0f172a" }}>{opponentName}&apos;s Team</h3>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>Total: <strong style={{ color: "#dc2626" }}>{oppTotal} pts</strong></div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Player", "Runs", "Wkts", "Ct", "Breakdown", "Points"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {oppPlayers.map((p) => <PlayerRow key={p.id} p={p} opponentName={opponentName} />)}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const section: CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 20, padding: 20 };
const th: CSSProperties = { textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #e2e8f0", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };
const td: CSSProperties = { padding: "12px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 14, verticalAlign: "top" };
const linkBack: CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 500 };
