"use client";

import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from "recharts";
import type { CSSProperties } from "react";
import NavBar from "@/components/NavBar";
import Link from "next/link";

type MatchStat = {
  matchId: number;
  fixture: string;
  date: string;
  yourPoints: number;
  oppPoints: number;
  yourCumulative: number;
  oppCumulative: number;
  winner: string | null;
  pointsDiff: number;
  hasData: boolean;
  isCurrent?: boolean;
  players: { name: string; side: string; captain: boolean; points: number; runs: number; wickets: number; catches: number }[];
};

type LeaderboardEntry = {
  name: string;
  side: string;
  totalPoints: number;
  matches: number;
  runs: number;
  wickets: number;
  catches: number;
};

type Props = {
  opponentName: string;
  matchStats: MatchStat[];
  leaderboard: LeaderboardEntry[];
  summary: {
    yourWins: number;
    oppWins: number;
    ties: number;
    yourTotal: number;
    oppTotal: number;
    matchesPlayed: number;
  };
};

const YOU_COLOR = "#2563eb";
const OPP_COLOR = "#dc2626";

function shortFixture(f: string) {
  const m = f.match(/match\s*(\d+)/i);
  if (m) return `M${m[1]}`;
  return f.slice(0, 6);
}

function ScoreCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4, color: color ?? "#0f172a" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function StatsClient({ opponentName, matchStats, leaderboard, summary }: Props) {
  const played = matchStats.filter((m) => m.hasData);

  const lineData = played.map((m, i) => ({
    name: shortFixture(m.fixture),
    fullName: m.fixture,
    You: m.yourCumulative,
    [opponentName]: m.oppCumulative,
    match: i + 1,
  }));

  const barData = played.map((m) => ({
    name: shortFixture(m.fixture),
    fullName: m.fixture,
    You: m.yourPoints,
    [opponentName]: m.oppPoints,
  }));

  const leader = summary.yourTotal === summary.oppTotal
    ? "Tied"
    : summary.yourTotal > summary.oppTotal
      ? `You lead by ${summary.yourTotal - summary.oppTotal} pts`
      : `${opponentName} leads by ${summary.oppTotal - summary.yourTotal} pts`;

  // True empty = no matches at all in the DB
  if (matchStats.length === 0) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <NavBar title="Series Overview" subtitle={`You vs ${opponentName}`} />
        <div style={{ textAlign: "center", padding: 60, background: "white", border: "1px solid #e2e8f0", borderRadius: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No matches yet</div>
          <div style={{ color: "#64748b", marginBottom: 24 }}>Link a match and select your players to get started.</div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/select" style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>👥 Select Teams</Link>
            <Link href="/match" style={{ ...btnSecondary, textDecoration: "none", display: "inline-block" }}>🏏 Live Match</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <NavBar title="Series Overview" subtitle={`You vs ${opponentName}`} />

      {/* Summary cards — always visible */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
        <ScoreCard label="Your Total" value={summary.yourTotal} sub="series points" color={YOU_COLOR} />
        <ScoreCard label={`${opponentName}'s Total`} value={summary.oppTotal} sub="series points" color={OPP_COLOR} />
        <ScoreCard
          label="Leader"
          value={summary.yourTotal > summary.oppTotal ? "You" : summary.oppTotal > summary.yourTotal ? opponentName : played.length > 0 ? "Tied" : "—"}
          sub={played.length > 0 ? leader : "Sync scores to update"}
          color={summary.yourTotal > summary.oppTotal ? YOU_COLOR : summary.oppTotal > summary.yourTotal ? OPP_COLOR : "#92400e"}
        />
        <ScoreCard label="Your Wins" value={summary.yourWins} sub={`${summary.oppWins}W ${summary.ties}T for ${opponentName}`} color={YOU_COLOR} />
        <ScoreCard label="Matches" value={matchStats.length} sub={`${played.length} synced`} />
      </div>

      {/* Charts — only when we have score data */}
      {played.length > 0 && (
        <>
          {/* Running total line chart */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Running Series Total</h2>
            <p style={sectionSub}>Cumulative fantasy points across all matches</p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={lineData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName ?? label} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line type="monotone" dataKey="You" stroke={YOU_COLOR} strokeWidth={3} dot={{ r: 5, fill: YOU_COLOR }} activeDot={{ r: 7 }} />
                <Line type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={3} dot={{ r: 5, fill: OPP_COLOR }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Per-match bar chart */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Match-by-Match Points</h2>
            <p style={sectionSub}>Fantasy points scored in each match</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} labelFormatter={(label, payload) => payload?.[0]?.payload?.fullName ?? label} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <ReferenceLine y={0} stroke="#e2e8f0" />
                <Bar dataKey="You" fill={YOU_COLOR} radius={[6, 6, 0, 0]} />
                <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Match results table — always visible */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Match Results</h2>
        <p style={sectionSub}>Click View → on any match to see detailed player scores</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Match", "Date", "Your Pts", `${opponentName} Pts`, "Winner", "Diff", ""].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matchStats.map((m) => {
                const youWon = m.winner === "You";
                const oppWon = m.winner === opponentName;
                return (
                  <tr key={m.matchId} style={{ background: m.isCurrent ? "#f0fdf4" : "transparent" }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {m.fixture}
                      {m.isCurrent && <span style={{ marginLeft: 6, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#16a34a", fontSize: 11, fontWeight: 700 }}>Current</span>}
                    </td>
                    <td style={{ ...tdStyle, color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap" }}>{m.date || "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: youWon ? YOU_COLOR : "#0f172a" }}>{m.hasData ? m.yourPoints : "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: oppWon ? OPP_COLOR : "#0f172a" }}>{m.hasData ? m.oppPoints : "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: youWon ? YOU_COLOR : oppWon ? OPP_COLOR : "#92400e" }}>{m.winner ?? "—"}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{m.hasData ? `${m.pointsDiff} pts` : "—"}</td>
                    <td style={{ ...tdStyle }}>
                      <Link href={`/match/${m.matchId}`} style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #e2e8f0", color: "#475569", textDecoration: "none", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap" }}>
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {played.length === 0 && (
          <div style={{ textAlign: "center", padding: "24px 0 8px", color: "#94a3b8", fontSize: 13 }}>
            Scores not synced yet — go to{" "}
            <Link href="/match" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>Live Match</Link>
            {" "}and click Sync Scores Now
          </div>
        )}
      </div>

      {/* Player leaderboard — only shown if there's score data */}
      {leaderboard.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitle}>Player Leaderboard</h2>
          <p style={sectionSub}>Total fantasy points across all series matches</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["#", "Player", "Team", "Matches", "Runs", "Wkts", "Ct", "Points"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((p, i) => (
                  <tr key={`${p.side}-${p.name}`} style={{ background: i % 2 === 0 ? "white" : "#f8fafc" }}>
                    <td style={{ ...tdStyle, color: i === 0 ? "#d97706" : "#94a3b8", fontWeight: 700 }}>{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{p.name}</td>
                    <td style={tdStyle}>
                      <span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: p.side === "You" ? "#dbeafe" : "#fee2e2", color: p.side === "You" ? YOU_COLOR : OPP_COLOR }}>
                        {p.side === "You" ? "You" : opponentName}
                      </span>
                    </td>
                    <td style={tdStyle}>{p.matches}</td>
                    <td style={tdStyle}>{p.runs}</td>
                    <td style={tdStyle}>{p.wickets}</td>
                    <td style={tdStyle}>{p.catches}</td>
                    <td style={{ ...tdStyle, fontWeight: 800, fontSize: 15, color: "#0f172a" }}>{p.totalPoints}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const cardStyle: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
const sectionStyle: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 20, background: "white", padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
const sectionTitle: CSSProperties = { margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#0f172a" };
const sectionSub: CSSProperties = { margin: "0 0 20px", fontSize: 13, color: "#64748b" };
const thStyle: CSSProperties = { textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #e2e8f0", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };
const tdStyle: CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };
const btnPrimary: CSSProperties = { padding: "10px 18px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: CSSProperties = { ...btnPrimary, background: "white", color: "#0f172a" };
