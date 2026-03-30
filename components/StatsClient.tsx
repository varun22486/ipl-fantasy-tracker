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
  name: string; side: string; totalPoints: number; matches: number;
  runs: number; wickets: number; catches: number;
};

type Props = {
  yourName: string;
  opponentName: string;
  matchStats: MatchStat[];
  leaderboard: LeaderboardEntry[];
  summary: { yourWins: number; oppWins: number; ties: number; yourTotal: number; oppTotal: number; matchesPlayed: number };
};

const YOU_COLOR = "#2563eb";
const OPP_COLOR = "#dc2626";

function shortFixture(f: string) {
  const m = f.match(/match\s*(\d+)/i);
  if (m) return `M${m[1]}`;
  return f.slice(0, 6);
}

function StatCard({ label, value, sub, color, accent }: { label: string; value: string | number; sub?: string; color?: string; accent?: string }) {
  return (
    <div style={{ ...cardStyle, borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: color ?? "#0f172a" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Compute derived analytics
function computeInsights(played: MatchStat[], yourName: string, opponentName: string) {
  if (played.length === 0) return null;

  // Current streak
  let streak = 1;
  let streakSide = played[played.length - 1].winner;
  for (let i = played.length - 2; i >= 0; i--) {
    if (played[i].winner === streakSide) streak++;
    else break;
  }

  // Averages
  const yourAvg = played.reduce((s, m) => s + m.yourPoints, 0) / played.length;
  const oppAvg = played.reduce((s, m) => s + m.oppPoints, 0) / played.length;

  // Best / closest match
  const biggestWin = played.reduce((best, m) => m.pointsDiff > best.pointsDiff ? m : best, played[0]);
  const closest = played.reduce((best, m) => m.pointsDiff < best.pointsDiff ? m : best, played[0]);

  // Best individual performance
  let topPerf = { name: "", side: "", points: 0, fixture: "" };
  for (const m of played) {
    for (const p of m.players) {
      if (p.points > topPerf.points) topPerf = { name: p.name, side: p.side, points: p.points, fixture: m.fixture };
    }
  }

  // Captain contribution %
  const captainPts = { you: 0, opp: 0 };
  const totalPts = { you: 0, opp: 0 };
  for (const m of played) {
    for (const p of m.players) {
      const isYou = p.side === "You";
      if (isYou) { totalPts.you += p.points; if (p.captain) captainPts.you += p.points; }
      else { totalPts.opp += p.points; if (p.captain) captainPts.opp += p.points; }
    }
  }
  const capPctYou = totalPts.you > 0 ? Math.round((captainPts.you / totalPts.you) * 100) : 0;
  const capPctOpp = totalPts.opp > 0 ? Math.round((captainPts.opp / totalPts.opp) * 100) : 0;

  // Points breakdown per category
  const breakdown = { you: { runs: 0, wickets: 0, catches: 0 }, opp: { runs: 0, wickets: 0, catches: 0 } };
  for (const m of played) {
    for (const p of m.players) {
      const mult = p.captain ? 2 : 1;
      const isYou = p.side === "You";
      const side = isYou ? breakdown.you : breakdown.opp;
      side.runs += p.runs * mult;
      side.wickets += p.wickets * 20 * mult;
      side.catches += p.catches * 10 * mult;
    }
  }

  // Momentum (last 3 vs first 3)
  const half = Math.min(3, Math.floor(played.length / 2));
  const earlyYourAvg = half > 0 ? played.slice(0, half).reduce((s, m) => s + m.yourPoints, 0) / half : 0;
  const earlyOppAvg = half > 0 ? played.slice(0, half).reduce((s, m) => s + m.oppPoints, 0) / half : 0;
  const recentYourAvg = half > 0 ? played.slice(-half).reduce((s, m) => s + m.yourPoints, 0) / half : 0;
  const recentOppAvg = half > 0 ? played.slice(-half).reduce((s, m) => s + m.oppPoints, 0) / half : 0;
  const yourTrend = recentYourAvg - earlyYourAvg;
  const oppTrend = recentOppAvg - earlyOppAvg;

  return {
    streak, streakSide,
    yourAvg: Math.round(yourAvg * 10) / 10,
    oppAvg: Math.round(oppAvg * 10) / 10,
    biggestWin, closest, topPerf,
    capPctYou, capPctOpp,
    breakdown,
    yourTrend: Math.round(yourTrend * 10) / 10,
    oppTrend: Math.round(oppTrend * 10) / 10,
  };
}

export default function StatsClient({ yourName, opponentName, matchStats, leaderboard, summary }: Props) {
  const played = matchStats.filter((m) => m.hasData);
  const insights = computeInsights(played, yourName, opponentName);

  const lineData = played.map((m) => ({
    name: shortFixture(m.fixture),
    fullName: m.fixture,
    [yourName]: m.yourCumulative,
    [opponentName]: m.oppCumulative,
  }));

  const barData = played.map((m) => ({
    name: shortFixture(m.fixture),
    fullName: m.fixture,
    [yourName]: m.yourPoints,
    [opponentName]: m.oppPoints,
  }));

  const leader = summary.yourTotal === summary.oppTotal ? "Tied"
    : summary.yourTotal > summary.oppTotal
      ? `${yourName} leads by ${summary.yourTotal - summary.oppTotal} pts`
      : `${opponentName} leads by ${summary.oppTotal - summary.yourTotal} pts`;

  if (matchStats.length === 0) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <NavBar title="Series Overview" subtitle={`${yourName} vs ${opponentName}`} />
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
      <NavBar title="Series Overview" subtitle={`${yourName} vs ${opponentName}`} />

      {/* ── Summary scorecards ─────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
        <StatCard label={`${yourName}'s Total`} value={summary.yourTotal} sub="series pts" color={YOU_COLOR} accent={YOU_COLOR} />
        <StatCard label={`${opponentName}'s Total`} value={summary.oppTotal} sub="series pts" color={OPP_COLOR} accent={OPP_COLOR} />
        <StatCard
          label="Leader"
          value={summary.yourTotal > summary.oppTotal ? yourName : summary.oppTotal > summary.yourTotal ? opponentName : "Tied"}
          sub={played.length > 0 ? leader : "No data"}
          color={summary.yourTotal > summary.oppTotal ? YOU_COLOR : summary.oppTotal > summary.yourTotal ? OPP_COLOR : "#92400e"}
        />
        <StatCard label={`${yourName}'s Wins`} value={summary.yourWins} sub={`${summary.oppWins}W ${summary.ties}T for ${opponentName}`} color={YOU_COLOR} />
        <StatCard label="Matches" value={matchStats.length} sub={`${played.length} synced`} />
      </div>

      {/* ── Insights strip (only when data exists) ────── */}
      {insights && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>

          {/* Current streak */}
          <div style={insightCard}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Current Streak</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {played.slice(-5).map((m, i) => (
                <div key={i} title={m.fixture} style={{
                  width: 28, height: 28, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 700, fontSize: 11,
                  background: m.winner === yourName || m.winner === "You" ? "#dbeafe" : m.winner === opponentName ? "#fee2e2" : "#fef9c3",
                  color: m.winner === yourName || m.winner === "You" ? YOU_COLOR : m.winner === opponentName ? OPP_COLOR : "#92400e",
                }}>
                  {m.winner === yourName || m.winner === "You" ? "W" : m.winner === opponentName ? "L" : "T"}
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontWeight: 700, fontSize: 14 }}>
              {insights.streak >= 2
                ? `${insights.streakSide === yourName || insights.streakSide === "You" ? yourName : insights.streakSide === opponentName ? opponentName : "Tie"} on ${insights.streak}-match run`
                : "No current streak"}
            </div>
          </div>

          {/* Averages */}
          <div style={insightCard}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Avg Per Match</div>
            <div style={{ display: "flex", gap: 16 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: YOU_COLOR }}>{insights.yourAvg}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{yourName}</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 300, color: "#d1d5db", alignSelf: "center" }}>vs</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 800, color: OPP_COLOR }}>{insights.oppAvg}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{opponentName}</div>
              </div>
            </div>
          </div>

          {/* Best single match */}
          <div style={insightCard}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Best Individual</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: insights.topPerf.side === "You" ? YOU_COLOR : OPP_COLOR }}>
              {insights.topPerf.points} pts
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{insights.topPerf.name}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{insights.topPerf.fixture}</div>
          </div>

          {/* Momentum */}
          {played.length >= 4 && (
            <div style={insightCard}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Momentum (last 3)</div>
              {[
                { name: yourName, trend: insights.yourTrend, color: YOU_COLOR },
                { name: opponentName, trend: insights.oppTrend, color: OPP_COLOR },
              ].map(({ name, trend, color }) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: "#334155", width: 70, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                  <span style={{ fontSize: 16, color: trend > 0 ? "#16a34a" : trend < 0 ? "#dc2626" : "#94a3b8" }}>
                    {trend > 0 ? "▲" : trend < 0 ? "▼" : "—"}
                  </span>
                  <span style={{ fontWeight: 700, fontSize: 14, color }}>
                    {trend > 0 ? `+${trend}` : trend} avg
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Biggest win */}
          <div style={insightCard}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Biggest Win</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: insights.biggestWin.winner === yourName || insights.biggestWin.winner === "You" ? YOU_COLOR : OPP_COLOR }}>
              +{insights.biggestWin.pointsDiff} pts
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>
              {insights.biggestWin.winner === "You" ? yourName : insights.biggestWin.winner}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{insights.biggestWin.fixture}</div>
          </div>

          {/* Closest match */}
          <div style={insightCard}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Closest Match</div>
            <div style={{ fontWeight: 800, fontSize: 20, color: "#92400e" }}>
              {insights.closest.pointsDiff} pt{insights.closest.pointsDiff !== 1 ? "s" : ""}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 2 }}>{insights.closest.fixture}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              {insights.closest.yourPoints} vs {insights.closest.oppPoints}
            </div>
          </div>

          {/* Captain contribution */}
          <div style={insightCard}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Captain Contribution</div>
            {[
              { name: yourName, pct: insights.capPctYou, color: YOU_COLOR },
              { name: opponentName, pct: insights.capPctOpp, color: OPP_COLOR },
            ].map(({ name, pct, color }) => (
              <div key={name} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span style={{ color: "#334155" }}>{name}</span>
                  <span style={{ fontWeight: 700, color }}>{pct}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "#f1f5f9", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 999 }} />
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>% of team pts from captain</div>
          </div>

          {/* Scoring breakdown */}
          <div style={insightCard}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>How Points Are Scored</div>
            {[
              { label: "Runs", you: insights.breakdown.you.runs, opp: insights.breakdown.opp.runs },
              { label: "Wickets", you: insights.breakdown.you.wickets, opp: insights.breakdown.opp.wickets },
              { label: "Catches", you: insights.breakdown.you.catches, opp: insights.breakdown.opp.catches },
            ].map(({ label, you, opp }) => {
              const total = you + opp;
              const pctYou = total > 0 ? Math.round((you / total) * 100) : 50;
              return (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                    <span style={{ color: YOU_COLOR, fontWeight: 600 }}>{you}</span>
                    <span style={{ color: "#64748b" }}>{label}</span>
                    <span style={{ color: OPP_COLOR, fontWeight: 600 }}>{opp}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 999, background: `${OPP_COLOR}33`, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pctYou}%`, background: YOU_COLOR, borderRadius: 999 }} />
                  </div>
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              <span>{yourName}</span><span>{opponentName}</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Charts (only when synced data exists) ─────── */}
      {played.length > 0 && (
        <>
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Running Series Total</h2>
            <p style={sectionSub}>Cumulative fantasy points — who's ahead in the series</p>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={lineData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} labelFormatter={(_l: unknown, p: any[]) => p?.[0]?.payload?.fullName ?? _l} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Line type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={3} dot={{ r: 5, fill: YOU_COLOR }} activeDot={{ r: 7 }} />
                <Line type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={3} dot={{ r: 5, fill: OPP_COLOR }} activeDot={{ r: 7 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Match-by-Match Points</h2>
            <p style={sectionSub}>Fantasy points scored in each individual match</p>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 13 }} labelFormatter={(_l: unknown, p: any[]) => p?.[0]?.payload?.fullName ?? _l} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <ReferenceLine y={0} stroke="#e2e8f0" />
                <Bar dataKey={yourName} fill={YOU_COLOR} radius={[6, 6, 0, 0]} />
                <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* ── Match results table — always visible ──────── */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Match Results</h2>
        <p style={sectionSub}>Click View → on any match to see the full player score breakdown</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Match", "Date", `${yourName}`, `${opponentName}`, "Winner", "Diff", ""].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matchStats.map((m) => {
                const youWon = m.winner === yourName || m.winner === "You";
                const oppWon = m.winner === opponentName;
                return (
                  <tr key={m.matchId} style={{ background: m.isCurrent ? "#f0fdf4" : "transparent" }}>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>
                      {m.fixture}
                      {m.isCurrent && <span style={{ marginLeft: 6, padding: "2px 8px", borderRadius: 999, background: "#dcfce7", color: "#16a34a", fontSize: 11, fontWeight: 700 }}>Live</span>}
                    </td>
                    <td style={{ ...tdStyle, color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap" }}>{m.date || "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: youWon ? YOU_COLOR : "#0f172a" }}>{m.hasData ? m.yourPoints : "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 700, color: oppWon ? OPP_COLOR : "#0f172a" }}>{m.hasData ? m.oppPoints : "—"}</td>
                    <td style={{ ...tdStyle, fontWeight: 600, color: youWon ? YOU_COLOR : oppWon ? OPP_COLOR : "#92400e" }}>{m.winner === "You" ? yourName : (m.winner ?? "—")}</td>
                    <td style={{ ...tdStyle, color: "#64748b" }}>{m.hasData ? `${m.pointsDiff} pts` : "—"}</td>
                    <td style={tdStyle}>
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
            Scores not synced yet —{" "}
            <Link href="/match" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>go to Live Match</Link>
            {" "}and click Sync Scores Now
          </div>
        )}
      </div>

      {/* ── Player leaderboard ────────────────────────── */}
      {leaderboard.filter(p => p.totalPoints > 0).length > 0 && (
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
                        {p.side === "You" ? yourName : opponentName}
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
const insightCard: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const sectionStyle: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 20, background: "white", padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
const sectionTitle: CSSProperties = { margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#0f172a" };
const sectionSub: CSSProperties = { margin: "0 0 20px", fontSize: 13, color: "#64748b" };
const thStyle: CSSProperties = { textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #e2e8f0", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };
const tdStyle: CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };
const btnPrimary: CSSProperties = { padding: "10px 18px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: CSSProperties = { ...btnPrimary, background: "white", color: "#0f172a" };
