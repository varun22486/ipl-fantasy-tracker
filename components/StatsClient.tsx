"use client";

import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ScatterChart, Scatter, ZAxis, Cell,
  ComposedChart,
} from "recharts";
import type { CSSProperties } from "react";
import NavBar from "@/components/NavBar";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────
type PlayerStat = { name: string; side: string; captain: boolean; points: number; runs: number; wickets: number; catches: number };

type MatchStat = {
  matchId: number; fixture: string; date: string;
  yourPoints: number; oppPoints: number;
  yourCumulative: number; oppCumulative: number;
  winner: string | null; pointsDiff: number; hasData: boolean; isCurrent?: boolean;
  players: PlayerStat[];
};

type LeaderboardEntry = {
  name: string; side: string; totalPoints: number; matches: number;
  runs: number; wickets: number; catches: number;
};

type Props = {
  yourName: string; opponentName: string;
  matchStats: MatchStat[];
  leaderboard: LeaderboardEntry[];
  summary: { yourWins: number; oppWins: number; ties: number; yourTotal: number; oppTotal: number; matchesPlayed: number };
};

// ── Palette ───────────────────────────────────────────────────────────────────
const YOU_COLOR  = "#2563eb";
const OPP_COLOR  = "#dc2626";
const YOU_LIGHT  = "#dbeafe";
const OPP_LIGHT  = "#fee2e2";
const PLAYER_COLORS = ["#3b82f6","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899","#6366f1","#14b8a6"];

function shortFixture(f: string) {
  const m = f.match(/match\s*(\d+)/i);
  return m ? `M${m[1]}` : f.slice(0, 5);
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, accent }: { label: string; value: string | number; sub?: string; color?: string; accent?: string }) {
  return (
    <div style={{ ...cardStyle, borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: color ?? "#0f172a" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// Custom tooltip wrapper
function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 14px", fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#0f172a" }}>{payload[0]?.payload?.fullName ?? label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color ?? p.fill, display: "inline-block" }} />
          <span style={{ color: "#475569" }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: "#0f172a" }}>{formatter ? formatter(p.value, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Computed analytics ────────────────────────────────────────────────────────
function computeInsights(played: MatchStat[], yourName: string, opponentName: string) {
  if (played.length === 0) return null;

  let streak = 1, streakSide = played[played.length - 1].winner;
  for (let i = played.length - 2; i >= 0; i--) {
    if (played[i].winner === streakSide) streak++; else break;
  }

  const yourAvg = played.reduce((s, m) => s + m.yourPoints, 0) / played.length;
  const oppAvg  = played.reduce((s, m) => s + m.oppPoints, 0) / played.length;
  const biggestWin = played.reduce((b, m) => m.pointsDiff > b.pointsDiff ? m : b, played[0]);
  const closest    = played.reduce((b, m) => m.pointsDiff < b.pointsDiff ? m : b, played[0]);

  let topPerf = { name: "", side: "", points: 0, fixture: "" };
  for (const m of played) for (const p of m.players)
    if (p.points > topPerf.points) topPerf = { name: p.name, side: p.side, points: p.points, fixture: m.fixture };

  const capPts = { you: 0, opp: 0 }, totalPts = { you: 0, opp: 0 };
  const brkd = { you: { runs: 0, wkts: 0, catches: 0 }, opp: { runs: 0, wkts: 0, catches: 0 } };
  for (const m of played) for (const p of m.players) {
    const mult = p.captain ? 2 : 1, isYou = p.side === "You";
    const ts = isYou ? totalPts.you : totalPts.opp;
    if (isYou) { totalPts.you += p.points; if (p.captain) capPts.you += p.points; brkd.you.runs += p.runs * mult; brkd.you.wkts += p.wickets * 20 * mult; brkd.you.catches += p.catches * 10 * mult; }
    else        { totalPts.opp += p.points; if (p.captain) capPts.opp += p.points; brkd.opp.runs += p.runs * mult; brkd.opp.wkts += p.wickets * 20 * mult; brkd.opp.catches += p.catches * 10 * mult; }
    void ts;
  }

  const capPctYou = totalPts.you > 0 ? Math.round((capPts.you / totalPts.you) * 100) : 0;
  const capPctOpp = totalPts.opp > 0 ? Math.round((capPts.opp / totalPts.opp) * 100) : 0;

  const half = Math.min(3, Math.floor(played.length / 2));
  const yourTrend = half > 0 ? Math.round(((played.slice(-half).reduce((s, m) => s + m.yourPoints, 0) - played.slice(0, half).reduce((s, m) => s + m.yourPoints, 0)) / half) * 10) / 10 : 0;
  const oppTrend  = half > 0 ? Math.round(((played.slice(-half).reduce((s, m) => s + m.oppPoints, 0)  - played.slice(0, half).reduce((s, m) => s + m.oppPoints, 0))  / half) * 10) / 10 : 0;

  return { streak, streakSide, yourAvg: Math.round(yourAvg * 10) / 10, oppAvg: Math.round(oppAvg * 10) / 10, biggestWin, closest, topPerf, capPctYou, capPctOpp, brkd, yourTrend, oppTrend };
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function StatsClient({ yourName, opponentName, matchStats, leaderboard, summary }: Props) {
  const played = matchStats.filter((m) => m.hasData);
  const ins = computeInsights(played, yourName, opponentName);

  // ── Chart datasets ──────────────────────────────────────────────────────────

  // 1. Running total + momentum gap (combined)
  const cumulData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]: m.yourCumulative, [opponentName]: m.oppCumulative,
    gap: m.yourCumulative - m.oppCumulative,
  }));

  // 2. Per-match bars
  const barData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]: m.yourPoints, [opponentName]: m.oppPoints,
  }));

  // 3. Radar data (normalized 0–100)
  const maxAvg = Math.max(ins?.yourAvg ?? 1, ins?.oppAvg ?? 1, 1);
  const maxBat = Math.max((ins?.brkd.you.runs ?? 0) / Math.max(played.length, 1), (ins?.brkd.opp.runs ?? 0) / Math.max(played.length, 1), 1);
  const maxBwl = Math.max((ins?.brkd.you.wkts ?? 0) / Math.max(played.length, 1), (ins?.brkd.opp.wkts ?? 0) / Math.max(played.length, 1), 1);
  const maxFld = Math.max((ins?.brkd.you.catches ?? 0) / Math.max(played.length, 1), (ins?.brkd.opp.catches ?? 0) / Math.max(played.length, 1), 1);
  const radarData = ins && played.length > 0 ? [
    { metric: "Win Rate",    [yourName]: Math.round((summary.yourWins / played.length) * 100), [opponentName]: Math.round((summary.oppWins / played.length) * 100) },
    { metric: "Avg Score",   [yourName]: Math.round((ins.yourAvg / maxAvg) * 100), [opponentName]: Math.round((ins.oppAvg / maxAvg) * 100) },
    { metric: "Batting",     [yourName]: Math.round(((ins.brkd.you.runs / played.length) / maxBat) * 100), [opponentName]: Math.round(((ins.brkd.opp.runs / played.length) / maxBat) * 100) },
    { metric: "Bowling",     [yourName]: Math.round(((ins.brkd.you.wkts / played.length) / maxBwl) * 100), [opponentName]: Math.round(((ins.brkd.opp.wkts / played.length) / maxBwl) * 100) },
    { metric: "Fielding",    [yourName]: Math.round(((ins.brkd.you.catches / played.length) / maxFld) * 100), [opponentName]: Math.round(((ins.brkd.opp.catches / played.length) / maxFld) * 100) },
    { metric: "Cap Impact",  [yourName]: ins.capPctYou, [opponentName]: ins.capPctOpp },
  ] : [];

  // 4. Player scatter data (runs vs pts, size = matches)
  const yourScatter = leaderboard.filter((p) => p.side === "You").map((p) => ({ x: p.runs, y: p.totalPoints, z: Math.max(p.matches * 60, 40), name: p.name }));
  const oppScatter  = leaderboard.filter((p) => p.side !== "You").map((p) => ({ x: p.runs, y: p.totalPoints, z: Math.max(p.matches * 60, 40), name: p.name }));

  // 5. Stacked player contributions per match
  // Find all unique players per side (ordered by total pts desc)
  const yourPlayerNames = leaderboard.filter((p) => p.side === "You").slice(0, 5).map((p) => p.name);
  const oppPlayerNames  = leaderboard.filter((p) => p.side !== "You").slice(0, 5).map((p) => p.name);
  const playerContribData = played.map((m) => {
    const row: Record<string, string | number> = { name: shortFixture(m.fixture), fullName: m.fixture };
    for (const pn of yourPlayerNames) {
      const found = m.players.find((p) => p.name === pn && p.side === "You");
      row[`Y_${pn}`] = found ? found.points : 0;
    }
    for (const pn of oppPlayerNames) {
      const found = m.players.find((p) => p.name === pn && p.side !== "You");
      row[`O_${pn}`] = found ? found.points : 0;
    }
    return row;
  });

  const leader = summary.yourTotal === summary.oppTotal ? "Tied"
    : summary.yourTotal > summary.oppTotal ? `${yourName} leads by ${summary.yourTotal - summary.oppTotal}`
    : `${opponentName} leads by ${summary.oppTotal - summary.yourTotal}`;

  if (matchStats.length === 0) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <NavBar title="Series Overview" subtitle={`${yourName} vs ${opponentName}`} />
        <div style={{ textAlign: "center", padding: 60, background: "white", border: "1px solid #e2e8f0", borderRadius: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No matches yet</div>
          <div style={{ color: "#64748b", marginBottom: 24 }}>Link a match and select your players to get started.</div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
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

      {/* ── Summary scorecards ─────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
        <StatCard label={`${yourName}'s Total`} value={summary.yourTotal} sub="series pts" color={YOU_COLOR} accent={YOU_COLOR} />
        <StatCard label={`${opponentName}'s Total`} value={summary.oppTotal} sub="series pts" color={OPP_COLOR} accent={OPP_COLOR} />
        <StatCard label="Leader" value={summary.yourTotal > summary.oppTotal ? yourName : summary.oppTotal > summary.yourTotal ? opponentName : "Tied"} sub={played.length > 0 ? leader : "—"} color={summary.yourTotal > summary.oppTotal ? YOU_COLOR : OPP_COLOR} />
        <StatCard label={`${yourName}'s W`} value={summary.yourWins} sub={`${summary.oppWins}W ${summary.ties}T for ${opponentName}`} color={YOU_COLOR} />
        <StatCard label="Matches" value={matchStats.length} sub={`${played.length} synced`} />
      </div>

      {/* ── Insight mini-cards ─────────────────────────────────────────────── */}
      {ins && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          {/* Form */}
          <div style={insightCard}>
            <div style={insightLabel}>Last 5 Form</div>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              {played.slice(-5).map((m, i) => {
                const w = m.winner === "You" || m.winner === yourName;
                const l = m.winner === opponentName;
                return (
                  <div key={i} title={m.fixture} style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 12, background: w ? YOU_LIGHT : l ? OPP_LIGHT : "#fef9c3", color: w ? YOU_COLOR : l ? OPP_COLOR : "#92400e" }}>
                    {w ? "W" : l ? "L" : "T"}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: "#334155" }}>
              {ins.streak >= 2 ? `${ins.streakSide === "You" || ins.streakSide === yourName ? yourName : ins.streakSide === opponentName ? opponentName : "Tied"} on ${ins.streak}-match run` : "No current streak"}
            </div>
          </div>
          {/* Avg */}
          <div style={insightCard}>
            <div style={insightLabel}>Avg Per Match</div>
            <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
              <div><div style={{ fontSize: 22, fontWeight: 800, color: YOU_COLOR }}>{ins.yourAvg}</div><div style={{ fontSize: 11, color: "#64748b" }}>{yourName}</div></div>
              <div style={{ fontSize: 20, color: "#d1d5db", alignSelf: "center" }}>vs</div>
              <div><div style={{ fontSize: 22, fontWeight: 800, color: OPP_COLOR }}>{ins.oppAvg}</div><div style={{ fontSize: 11, color: "#64748b" }}>{opponentName}</div></div>
            </div>
          </div>
          {/* Best individual */}
          <div style={insightCard}>
            <div style={insightLabel}>Best Performance</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: ins.topPerf.side === "You" ? YOU_COLOR : OPP_COLOR, marginTop: 6 }}>{ins.topPerf.points} pts</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{ins.topPerf.name}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{ins.topPerf.fixture}</div>
          </div>
          {/* Momentum */}
          {played.length >= 4 && (
            <div style={insightCard}>
              <div style={insightLabel}>Recent Momentum</div>
              {[{ name: yourName, trend: ins.yourTrend, color: YOU_COLOR }, { name: opponentName, trend: ins.oppTrend, color: OPP_COLOR }].map(({ name, trend, color }) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: "#334155", flex: 1 }}>{name}</span>
                  <span style={{ fontSize: 16 }}>{trend > 0 ? "▲" : trend < 0 ? "▼" : "—"}</span>
                  <span style={{ fontWeight: 700, color }}>{trend > 0 ? `+${trend}` : trend}</span>
                </div>
              ))}
            </div>
          )}
          {/* Biggest win */}
          <div style={insightCard}>
            <div style={insightLabel}>Biggest Win</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: ins.biggestWin.winner === "You" || ins.biggestWin.winner === yourName ? YOU_COLOR : OPP_COLOR, marginTop: 6 }}>+{ins.biggestWin.pointsDiff} pts</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{ins.biggestWin.winner === "You" ? yourName : ins.biggestWin.winner}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{ins.biggestWin.fixture}</div>
          </div>
          {/* Closest */}
          <div style={insightCard}>
            <div style={insightLabel}>Closest Match</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "#92400e", marginTop: 6 }}>{ins.closest.pointsDiff} pt{ins.closest.pointsDiff !== 1 ? "s" : ""}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{ins.closest.fixture}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{ins.closest.yourPoints} vs {ins.closest.oppPoints}</div>
          </div>
        </div>
      )}

      {/* ── Charts ────────────────────────────────────────────────────────── */}
      {played.length > 0 && (
        <>
          {/* CHART 1: Series Momentum Gap (area) */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Series Momentum</h2>
            <p style={sectionSub}>Cumulative point gap — above 0 means {yourName} leads, below means {opponentName} leads</p>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={cumulData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gapUp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gapDown" x1="0" y1="1" x2="0" y2="0">
                    <stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v > 0 ? "+" : ""}${v} pts`} />} />
                <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={2} strokeDasharray="4 2" label={{ value: "Even", fill: "#94a3b8", fontSize: 11 }} />
                <Area type="monotone" dataKey="gap" stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#gapUp)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} activeDot={{ r: 6 }} name="Lead" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* CHART 2: Running Totals */}
          <div style={sectionStyle}>
            <h2 style={sectionTitle}>Running Series Total</h2>
            <p style={sectionSub}>Cumulative fantasy points — who is building the lead match by match</p>
            <ResponsiveContainer width="100%" height={270}>
              <AreaChart data={cumulData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradYou" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradOpp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 12, fill: "#64748b" }} />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} pts`} />} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={3} fill="url(#gradYou)" dot={{ r: 5, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} activeDot={{ r: 7 }} />
                <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={3} fill="url(#gradOpp)" dot={{ r: 5, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} activeDot={{ r: 7 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* CHART 3 & 4: Side-by-side bar + radar */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
            {/* Match-by-match bars */}
            <div style={sectionStyle}>
              <h2 style={sectionTitle}>Match-by-Match</h2>
              <p style={sectionSub}>Points scored in each individual match</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={barData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} pts`} />} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey={yourName} fill={YOU_COLOR} radius={[6, 6, 0, 0]} />
                  <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Team DNA Radar */}
            {radarData.length > 0 && (
              <div style={sectionStyle}>
                <h2 style={sectionTitle}>Team DNA</h2>
                <p style={sectionSub}>Normalised comparison across batting, bowling, fielding & tactics</p>
                <ResponsiveContainer width="100%" height={240}>
                  <RadarChart data={radarData} margin={{ top: 5, right: 30, left: 30, bottom: 5 }}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: "#475569" }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name={yourName} dataKey={yourName} stroke={YOU_COLOR} fill={YOU_COLOR} fillOpacity={0.18} strokeWidth={2} dot={{ r: 3, fill: YOU_COLOR }} />
                    <Radar name={opponentName} dataKey={opponentName} stroke={OPP_COLOR} fill={OPP_COLOR} fillOpacity={0.18} strokeWidth={2} dot={{ r: 3, fill: OPP_COLOR }} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Tooltip contentStyle={{ borderRadius: 10, fontSize: 13 }} formatter={(v: number) => `${v}/100`} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* CHART 5: Player scatter — Runs vs Total Points */}
          {(yourScatter.length > 0 || oppScatter.length > 0) && (
            <div style={sectionStyle}>
              <h2 style={sectionTitle}>Player Map — Runs vs Total Points</h2>
              <p style={sectionSub}>Each bubble is a player. X = total runs scored, Y = fantasy points earned. Size = matches played. Hover to see name.</p>
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" dataKey="x" name="Runs" tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "Runs scored", position: "insideBottom", offset: -4, fontSize: 12, fill: "#94a3b8" }} />
                  <YAxis type="number" dataKey="y" name="Points" tick={{ fontSize: 12, fill: "#64748b" }} label={{ value: "Fantasy pts", angle: -90, position: "insideLeft", fontSize: 12, fill: "#94a3b8" }} />
                  <ZAxis type="number" dataKey="z" range={[40, 400]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0]?.payload;
                    const isYou = yourScatter.some((s) => s.name === d?.name);
                    return (
                      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 12px", fontSize: 13 }}>
                        <div style={{ fontWeight: 700, color: isYou ? YOU_COLOR : OPP_COLOR }}>{d?.name}</div>
                        <div style={{ color: "#475569" }}>{d?.x} runs · {d?.y} pts</div>
                      </div>
                    );
                  }} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Scatter name={yourName} data={yourScatter} fill={YOU_COLOR} opacity={0.85} />
                  <Scatter name={opponentName} data={oppScatter} fill={OPP_COLOR} opacity={0.85} />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* CHART 6: Stacked player contribution per match */}
          {yourPlayerNames.length > 0 && playerContribData.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 20 }}>
              {[
                { title: `${yourName}'s Lineup`, keys: yourPlayerNames.map((n) => `Y_${n}`), names: yourPlayerNames },
                { title: `${opponentName}'s Lineup`, keys: oppPlayerNames.map((n) => `O_${n}`), names: oppPlayerNames },
              ].map(({ title, keys, names }, si) => (
                <div key={title} style={sectionStyle}>
                  <h2 style={sectionTitle}>{title}</h2>
                  <p style={sectionSub}>Who carried the team in each match</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={playerContribData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <Tooltip content={({ active, payload, label }: any) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>
                            <div style={{ fontWeight: 700, marginBottom: 6 }}>{payload[0]?.payload?.fullName ?? label}</div>
                            {payload.filter((p: any) => p.value > 0).map((p: any, i: number) => (
                              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: "inline-block" }} />
                                <span style={{ color: "#475569" }}>{p.name.replace(/^[YO]_/, "")}:</span>
                                <span style={{ fontWeight: 700 }}>{p.value} pts</span>
                              </div>
                            ))}
                          </div>
                        );
                      }} />
                      <Legend formatter={(v: string) => v.replace(/^[YO]_/, "")} wrapperStyle={{ fontSize: 12 }} />
                      {keys.map((k, i) => (
                        <Bar key={k} dataKey={k} name={k} stackId="a" fill={PLAYER_COLORS[i % PLAYER_COLORS.length]} radius={i === keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Match results table ────────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <h2 style={sectionTitle}>Match Results</h2>
        <p style={sectionSub}>Click View → to see full player score breakdown for any match</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Match", "Date", yourName, opponentName, "Winner", "Diff", ""].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matchStats.map((m) => {
                const youWon = m.winner === "You" || m.winner === yourName;
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
            No synced scores yet —{" "}
            <Link href="/match" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>go to Live Match</Link> and Sync Scores Now
          </div>
        )}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const cardStyle: CSSProperties    = { border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
const insightCard: CSSProperties  = { border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: "14px 16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
const insightLabel: CSSProperties = { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 };
const sectionStyle: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 20, background: "white", padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };
const sectionTitle: CSSProperties = { margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#0f172a" };
const sectionSub: CSSProperties   = { margin: "0 0 20px", fontSize: 13, color: "#64748b" };
const thStyle: CSSProperties      = { textAlign: "left", padding: "10px 12px", borderBottom: "2px solid #e2e8f0", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };
const tdStyle: CSSProperties      = { padding: "10px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 14 };
const btnPrimary: CSSProperties   = { padding: "10px 18px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer" };
const btnSecondary: CSSProperties = { ...btnPrimary, background: "white", color: "#0f172a" };
