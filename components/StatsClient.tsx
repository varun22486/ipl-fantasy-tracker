"use client";

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area,
  ComposedChart, Line, ReferenceLine,
} from "recharts";
import type { CSSProperties } from "react";
import Link from "next/link";
import { DEFAULT_SCORING } from "@/lib/scoring";

// ── Types ─────────────────────────────────────────────────────────────────────
type PlayerStat = { name: string; side: string; captain: boolean; points: number; runs: number; wickets: number; catches: number; runouts?: number; stumpings?: number };

type MatchStat = {
  matchId: number; fixture: string; date: string;
  yourPoints: number; oppPoints: number;
  yourCumulative: number; oppCumulative: number;
  winner: string | null; pointsDiff: number; hasData: boolean; isCurrent?: boolean;
  players: PlayerStat[];
};

type LeaderboardEntry = {
  name: string; side: string; totalPoints: number; matches: number;
  runs: number; wickets: number; catches: number; runouts?: number; stumpings?: number;
};

type Props = {
  yourName: string;
  opponentName: string;
  /** fantasy_players.side for your team: "You" (default) or player1 name (named competition). */
  youSide?: string;
  matchStats: MatchStat[];
  leaderboard: LeaderboardEntry[];
  summary: { yourWins: number; oppWins: number; ties: number; yourTotal: number; oppTotal: number; matchesPlayed: number };
};

// ── Palette ───────────────────────────────────────────────────────────────────
const YOU_COLOR  = "#2563eb";
const OPP_COLOR  = "#dc2626";
const YOU_LIGHT  = "#dbeafe";
const OPP_LIGHT  = "#fee2e2";

function shortFixture(f: string) {
  const m = f.match(/match\s*(\d+)/i);
  return m ? `M${m[1]}` : f.slice(0, 5);
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, accent }: { label: string; value: string | number; sub?: string; color?: string; accent?: string }) {
  return (
    <div className="ui-card" style={{ borderTop: accent ? `3px solid ${accent}` : undefined }}>
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
    <div className="chart-tooltip">
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
function computeInsights(played: MatchStat[], yourName: string, opponentName: string, youSide: string) {
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
  const roPts = DEFAULT_SCORING.runout;
  const stPts = DEFAULT_SCORING.stump;
  const brkd = { you: { runs: 0, wkts: 0, catches: 0, runouts: 0, stumpings: 0 }, opp: { runs: 0, wkts: 0, catches: 0, runouts: 0, stumpings: 0 } };
  for (const m of played) for (const p of m.players) {
    const mult = p.captain ? 2 : 1, isYou = p.side === youSide;
    const ts = isYou ? totalPts.you : totalPts.opp;
    const rOut = (p.runouts ?? 0) * roPts * mult;
    const stMp = (p.stumpings ?? 0) * stPts * mult;
    if (isYou) { totalPts.you += p.points; if (p.captain) capPts.you += p.points; brkd.you.runs += p.runs * mult; brkd.you.wkts += p.wickets * 20 * mult; brkd.you.catches += p.catches * 10 * mult; brkd.you.runouts += rOut; brkd.you.stumpings += stMp; }
    else        { totalPts.opp += p.points; if (p.captain) capPts.opp += p.points; brkd.opp.runs += p.runs * mult; brkd.opp.wkts += p.wickets * 20 * mult; brkd.opp.catches += p.catches * 10 * mult; brkd.opp.runouts += rOut; brkd.opp.stumpings += stMp; }
    void ts;
  }

  const capPctYou = totalPts.you > 0 ? Math.round((capPts.you / totalPts.you) * 100) : 0;
  const capPctOpp = totalPts.opp > 0 ? Math.round((capPts.opp / totalPts.opp) * 100) : 0;

  const half = Math.min(3, Math.floor(played.length / 2));
  const yourTrend = half > 0 ? Math.round(((played.slice(-half).reduce((s, m) => s + m.yourPoints, 0) - played.slice(0, half).reduce((s, m) => s + m.yourPoints, 0)) / half) * 10) / 10 : 0;
  const oppTrend  = half > 0 ? Math.round(((played.slice(-half).reduce((s, m) => s + m.oppPoints, 0)  - played.slice(0, half).reduce((s, m) => s + m.oppPoints, 0))  / half) * 10) / 10 : 0;

  return { streak, streakSide, yourAvg: Math.round(yourAvg), oppAvg: Math.round(oppAvg), biggestWin, closest, topPerf, capPctYou, capPctOpp, brkd, yourTrend, oppTrend };
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function StatsClient({ yourName, opponentName, youSide = "You", matchStats, leaderboard, summary }: Props) {
  const played = matchStats.filter((m) => m.hasData);
  const ins = computeInsights(played, yourName, opponentName, youSide);

  // ── Chart datasets ──────────────────────────────────────────────────────────

  // 1. Running total
  const cumulData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]: m.yourCumulative, [opponentName]: m.oppCumulative,
  }));

  // 2. Per-match bars
  const barData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]: m.yourPoints, [opponentName]: m.oppPoints,
  }));

  // 3. Captain points per match
  const captainPtsData = played.map((m) => {
    const yourCap = m.players.find((p) => p.side === youSide && p.captain);
    const oppCap  = m.players.find((p) => p.side !== youSide && p.captain);
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      yourCapName: yourCap?.name ?? "—",
      oppCapName:  oppCap?.name  ?? "—",
      [yourName]:    yourCap?.points ?? 0,
      [opponentName]: oppCap?.points ?? 0,
    };
  });

  // 4. Per-match runs / wickets / catches totals
  const runsData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]:     m.players.filter((p) => p.side === youSide).reduce((s, p) => s + p.runs, 0),
    [opponentName]: m.players.filter((p) => p.side !== youSide).reduce((s, p) => s + p.runs, 0),
  }));

  const wicketsData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]:     m.players.filter((p) => p.side === youSide).reduce((s, p) => s + p.wickets, 0),
    [opponentName]: m.players.filter((p) => p.side !== youSide).reduce((s, p) => s + p.wickets, 0),
  }));

  const catchesData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]:     m.players.filter((p) => p.side === youSide).reduce((s, p) => s + p.catches, 0),
    [opponentName]: m.players.filter((p) => p.side !== youSide).reduce((s, p) => s + p.catches, 0),
  }));

  // 5a. Cumulative running totals for each stat
  const runsRunningData    = played.map((m, i) => {
    const slice = played.slice(0, i + 1);
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      [yourName]:     slice.reduce((s, x) => s + x.players.filter((p) => p.side === youSide).reduce((a, p) => a + p.runs, 0), 0),
      [opponentName]: slice.reduce((s, x) => s + x.players.filter((p) => p.side !== youSide).reduce((a, p) => a + p.runs, 0), 0),
    };
  });
  const wicketsRunningData = played.map((m, i) => {
    const slice = played.slice(0, i + 1);
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      [yourName]:     slice.reduce((s, x) => s + x.players.filter((p) => p.side === youSide).reduce((a, p) => a + p.wickets, 0), 0),
      [opponentName]: slice.reduce((s, x) => s + x.players.filter((p) => p.side !== youSide).reduce((a, p) => a + p.wickets, 0), 0),
    };
  });
  const catchesRunningData = played.map((m, i) => {
    const slice = played.slice(0, i + 1);
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      [yourName]:     slice.reduce((s, x) => s + x.players.filter((p) => p.side === youSide).reduce((a, p) => a + p.catches, 0), 0),
      [opponentName]: slice.reduce((s, x) => s + x.players.filter((p) => p.side !== youSide).reduce((a, p) => a + p.catches, 0), 0),
    };
  });

  const runoutsData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]:     m.players.filter((p) => p.side === youSide).reduce((s, p) => s + (p.runouts ?? 0), 0),
    [opponentName]: m.players.filter((p) => p.side !== youSide).reduce((s, p) => s + (p.runouts ?? 0), 0),
  }));

  const runoutsRunningData = played.map((m, i) => {
    const slice = played.slice(0, i + 1);
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      [yourName]:     slice.reduce((s, x) => s + x.players.filter((p) => p.side === youSide).reduce((a, p) => a + (p.runouts ?? 0), 0), 0),
      [opponentName]: slice.reduce((s, x) => s + x.players.filter((p) => p.side !== youSide).reduce((a, p) => a + (p.runouts ?? 0), 0), 0),
    };
  });

  const stumpingsData = played.map((m) => ({
    name: shortFixture(m.fixture), fullName: m.fixture,
    [yourName]:     m.players.filter((p) => p.side === youSide).reduce((s, p) => s + (p.stumpings ?? 0), 0),
    [opponentName]: m.players.filter((p) => p.side !== youSide).reduce((s, p) => s + (p.stumpings ?? 0), 0),
  }));

  const stumpingsRunningData = played.map((m, i) => {
    const slice = played.slice(0, i + 1);
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      [yourName]:     slice.reduce((s, x) => s + x.players.filter((p) => p.side === youSide).reduce((a, p) => a + (p.stumpings ?? 0), 0), 0),
      [opponentName]: slice.reduce((s, x) => s + x.players.filter((p) => p.side !== youSide).reduce((a, p) => a + (p.stumpings ?? 0), 0), 0),
    };
  });

  // 5b. Cumulative captain points
  const captainPtsRunningData = played.map((m, i) => {
    const slice = played.slice(0, i + 1);
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      [yourName]:     slice.reduce((s, x) => s + (x.players.find((p) => p.side === youSide && p.captain)?.points ?? 0), 0),
      [opponentName]: slice.reduce((s, x) => s + (x.players.find((p) => p.side !== youSide && p.captain)?.points ?? 0), 0),
    };
  });

  // 6. Rolling win-rate (%) per match
  const winRateData = played.map((m, i) => {
    const slice = played.slice(0, i + 1);
    const yW = slice.filter((x) => x.winner === "You" || x.winner === yourName).length;
    const oW = slice.filter((x) => x.winner === opponentName).length;
    return {
      name: shortFixture(m.fixture), fullName: m.fixture,
      [yourName]: Math.round((yW / (i + 1)) * 100),
      [opponentName]: Math.round((oW / (i + 1)) * 100),
    };
  });

  // 5. Score-range distribution (how often each team hits each bracket)
  const RANGES = [
    { label: "0–49",   min: 0,   max: 49   },
    { label: "50–99",  min: 50,  max: 99   },
    { label: "100–149",min: 100, max: 149  },
    { label: "150–199",min: 150, max: 199  },
    { label: "200+",   min: 200, max: 9999 },
  ];
  const rangeData = RANGES.map(({ label, min, max }) => ({
    range: label,
    [yourName]:    played.filter((m) => m.yourPoints >= min && m.yourPoints <= max).length,
    [opponentName]:played.filter((m) => m.oppPoints  >= min && m.oppPoints  <= max).length,
  }));

  const leader = summary.yourTotal === summary.oppTotal ? "Tied"
    : summary.yourTotal > summary.oppTotal ? `${yourName} leads by ${summary.yourTotal - summary.oppTotal}`
    : `${opponentName} leads by ${summary.oppTotal - summary.yourTotal}`;

  if (matchStats.length === 0) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Insights & charts</h2>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748b" }}>{yourName} vs {opponentName}</p>
        </div>
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
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Insights & charts</h2>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748b" }}>{yourName} vs {opponentName}</p>
      </div>

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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px,100%), 1fr))", gap: 12 }}>
          <div className="insight-card insight-card--blue">
            <div style={insightLabel}>Last 5 Form</div>
            <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
              {played.slice(-5).map((m, i) => {
                const w = m.winner === "You" || m.winner === yourName;
                const l = m.winner === opponentName;
                return (
                  <div key={i} title={m.fixture} style={{ width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 11, background: w ? YOU_LIGHT : l ? OPP_LIGHT : "#fef9c3", color: w ? YOU_COLOR : l ? OPP_COLOR : "#92400e" }}>
                    {w ? "W" : l ? "L" : "T"}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#334155" }}>
              {ins.streak >= 2 ? `${ins.streakSide === "You" || ins.streakSide === yourName ? yourName : ins.streakSide === opponentName ? opponentName : "Tied"} — ${ins.streak} in a row` : "No streak yet"}
            </div>
          </div>

          <div className="insight-card insight-card--teal">
            <div style={insightLabel}>Avg per match</div>
            <div style={{ display: "flex", gap: 10, marginTop: 8, alignItems: "flex-end" }}>
              <div><div style={{ fontSize: 24, fontWeight: 800, color: YOU_COLOR, lineHeight: 1 }}>{ins.yourAvg}</div><div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{yourName}</div></div>
              <div style={{ fontSize: 13, color: "#d1d5db", paddingBottom: 14 }}>vs</div>
              <div><div style={{ fontSize: 24, fontWeight: 800, color: OPP_COLOR, lineHeight: 1 }}>{ins.oppAvg}</div><div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>{opponentName}</div></div>
            </div>
          </div>

          <div className="insight-card insight-card--amber">
            <div style={insightLabel}>Best performance</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: ins.topPerf.side === youSide ? YOU_COLOR : OPP_COLOR, marginTop: 6, lineHeight: 1 }}>{ins.topPerf.points}<span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}> pts</span></div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{ins.topPerf.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ins.topPerf.fixture}</div>
          </div>

          {played.length >= 4 && (
            <div className="insight-card insight-card--purple">
              <div style={insightLabel}>Momentum</div>
              {[{ name: yourName, trend: ins.yourTrend, color: YOU_COLOR }, { name: opponentName, trend: ins.oppTrend, color: OPP_COLOR }].map(({ name, trend, color }) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 999, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, color: "#334155", flex: 1 }}>{name}</span>
                  <span style={{ fontWeight: 700, fontSize: 13, color: trend > 0 ? "#16a34a" : trend < 0 ? "#dc2626" : "#94a3b8" }}>{trend > 0 ? `▲ +${trend}` : trend < 0 ? `▼ ${trend}` : "—"}</span>
                </div>
              ))}
            </div>
          )}

          <div className="insight-card insight-card--green">
            <div style={insightLabel}>Biggest win</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: ins.biggestWin.winner === "You" || ins.biggestWin.winner === yourName ? YOU_COLOR : OPP_COLOR, marginTop: 6, lineHeight: 1 }}>+{ins.biggestWin.pointsDiff}<span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}> pts</span></div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{ins.biggestWin.winner === "You" ? yourName : ins.biggestWin.winner} won</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ins.biggestWin.fixture}</div>
          </div>

          <div className="insight-card insight-card--red">
            <div style={insightLabel}>Closest match</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#d97706", marginTop: 6, lineHeight: 1 }}>{ins.closest.pointsDiff}<span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}> pt gap</span></div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{ins.closest.fixture}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ins.closest.yourPoints} vs {ins.closest.oppPoints}</div>
          </div>
        </div>
      )}

      {/* ── Charts with tab switcher ──────────────────────────────────────── */}
      {played.length > 0 && (
        <>
          {/* Points charts */}
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
            <div style={{ marginTop: 24 }}>
              <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Match-by-Match</h2>
              <p style={sectionSub}>Points scored in each individual match</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }} barCategoryGap="30%">
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
          </div>

          {/* Runs & Wickets charts */}
          {(
            <div style={sectionStyle}>
              <h2 style={sectionTitle}>Runs</h2>
              <p style={sectionSub}>Per-match total runs and cumulative series tally for each side</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20 }}>
                <div>
                  <div style={miniChartLabel}>Per Match</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={runsData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} runs`} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey={yourName} fill={YOU_COLOR} radius={[5, 5, 0, 0]} />
                      <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div style={miniChartLabel}>Cumulative Total</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={runsRunningData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="runsGradYou" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} /></linearGradient>
                        <linearGradient id="runsGradOpp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} runs`} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#runsGradYou)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} />
                      <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={2.5} fill="url(#runsGradOpp)" dot={{ r: 4, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={{ marginTop: 24 }}>
                <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Wickets</h2>
                <p style={sectionSub}>Per-match wickets taken and cumulative series tally</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20 }}>
                  <div>
                    <div style={miniChartLabel}>Per Match</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={wicketsData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} wkt${v !== 1 ? "s" : ""}`} />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey={yourName} fill={YOU_COLOR} radius={[5, 5, 0, 0]} />
                        <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div style={miniChartLabel}>Cumulative Total</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={wicketsRunningData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="wktsGradYou" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} /></linearGradient>
                          <linearGradient id="wktsGradOpp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} wkt${v !== 1 ? "s" : ""}`} />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#wktsGradYou)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} />
                        <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={2.5} fill="url(#wktsGradOpp)" dot={{ r: 4, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Catches & Captain charts */}
          {(
            <div style={sectionStyle}>
              <h2 style={sectionTitle}>Catches</h2>
              <p style={sectionSub}>Per-match catches and cumulative series tally</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20 }}>
                <div>
                  <div style={miniChartLabel}>Per Match</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={catchesData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} catch${v !== 1 ? "es" : ""}`} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey={yourName} fill={YOU_COLOR} radius={[5, 5, 0, 0]} />
                      <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[5, 5, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <div style={miniChartLabel}>Cumulative Total</div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={catchesRunningData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="ctGradYou" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} /></linearGradient>
                        <linearGradient id="ctGradOpp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                      <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} catch${v !== 1 ? "es" : ""}`} />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#ctGradYou)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} />
                      <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={2.5} fill="url(#ctGradOpp)" dot={{ r: 4, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div style={{ marginTop: 24 }}>
                <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Run-outs (fielding)</h2>
                <p style={sectionSub}>Per-match run-out credits and cumulative tally (each assisting fielder counts as one)</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20 }}>
                  <div>
                    <div style={miniChartLabel}>Per Match</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={runoutsData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} credit${v !== 1 ? "s" : ""}`} />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey={yourName} fill={YOU_COLOR} radius={[5, 5, 0, 0]} />
                        <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div style={miniChartLabel}>Cumulative Total</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={runoutsRunningData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="roGradYou" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} /></linearGradient>
                          <linearGradient id="roGradOpp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} credit${v !== 1 ? "s" : ""}`} />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#roGradYou)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} />
                        <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={2.5} fill="url(#roGradOpp)" dot={{ r: 4, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 24 }}>
                <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Stumpings (WK)</h2>
                <p style={sectionSub}>Per-match stumpings and cumulative tally</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20 }}>
                  <div>
                    <div style={miniChartLabel}>Per Match</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={stumpingsData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                        <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} stump${v !== 1 ? "s" : ""}`} />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey={yourName} fill={YOU_COLOR} radius={[5, 5, 0, 0]} />
                        <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[5, 5, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <div style={miniChartLabel}>Cumulative Total</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <AreaChart data={stumpingsRunningData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="stGradYou" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} /></linearGradient>
                          <linearGradient id="stGradOpp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} stump${v !== 1 ? "s" : ""}`} />} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#stGradYou)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} />
                        <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={2.5} fill="url(#stGradOpp)" dot={{ r: 4, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 24 }}>
                <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Captain Points</h2>
                <p style={sectionSub}>Per-match captain points (×2 applied) and cumulative tally — captain name in tooltip</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px,100%), 1fr))", gap: 20 }}>
              <div>
                <div style={miniChartLabel}>Per Match</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={captainPtsData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <Tooltip content={({ active, payload, label: lbl }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 14px", fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
                          <div style={{ fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{d?.fullName ?? lbl}</div>
                          {payload.map((p: any, i: number) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: p.fill, display: "inline-block" }} />
                              <span style={{ color: "#475569" }}>{p.name}:</span>
                              <span style={{ fontWeight: 700, color: "#0f172a" }}>{p.value} pts</span>
                              <span style={{ color: "#94a3b8", fontSize: 12 }}>({p.dataKey === yourName ? d?.yourCapName : d?.oppCapName})</span>
                            </div>
                          ))}
                        </div>
                      );
                    }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey={yourName} fill={YOU_COLOR} radius={[5, 5, 0, 0]} />
                    <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div style={miniChartLabel}>Cumulative Total</div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={captainPtsRunningData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="capGradYou" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={YOU_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} /></linearGradient>
                      <linearGradient id="capGradOpp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={OPP_COLOR} stopOpacity={0.18} /><stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                    <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} pts`} />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#capGradYou)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} />
                    <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={2.5} fill="url(#capGradOpp)" dot={{ r: 4, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              </div>
            </div>
          </div>
          )}

          {/* Distribution charts */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px,100%), 1fr))", gap: 20 }}>

            {/* Rolling win rate */}
            {played.length >= 2 && (
              <div style={sectionStyle}>
                <h2 style={sectionTitle}>Win Rate Over Time</h2>
                <p style={sectionSub}>Rolling win % after each match</p>
                <ResponsiveContainer width="100%" height={240}>
                  <ComposedChart data={winRateData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="winGradYou" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={YOU_COLOR} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={YOU_COLOR} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="winGradOpp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={OPP_COLOR} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={OPP_COLOR} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v: number) => `${v}%`} axisLine={false} tickLine={false} />
                    <ReferenceLine y={50} stroke="#cbd5e1" strokeDasharray="4 3" label={{ value: "50%", fill: "#94a3b8", fontSize: 11 }} />
                    <Tooltip content={<ChartTooltip formatter={(v: number) => `${v}%`} />} />
                    <Legend wrapperStyle={{ fontSize: 13 }} />
                    <Area type="monotone" dataKey={yourName} stroke={YOU_COLOR} strokeWidth={2.5} fill="url(#winGradYou)" dot={{ r: 4, fill: YOU_COLOR, stroke: "white", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                    <Area type="monotone" dataKey={opponentName} stroke={OPP_COLOR} strokeWidth={2.5} fill="url(#winGradOpp)" dot={{ r: 4, fill: OPP_COLOR, stroke: "white", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Score range distribution */}
            <div style={sectionStyle}>
              <h2 style={sectionTitle}>Score Distribution</h2>
              <p style={sectionSub}>How many matches each team fell in each points bracket — shows consistency</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={rangeData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="35%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="range" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} label={{ value: "matches", angle: -90, position: "insideLeft", fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} match${v !== 1 ? "es" : ""}`} />} />
                  <Legend wrapperStyle={{ fontSize: 13 }} />
                  <Bar dataKey={yourName} fill={YOU_COLOR} radius={[6, 6, 0, 0]} />
                  <Bar dataKey={opponentName} fill={OPP_COLOR} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      )}

    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const insightCard: CSSProperties  = { border: "1px solid var(--border)", borderRadius: 16, background: "var(--surface)", padding: "14px 16px", boxShadow: "var(--shadow-xs)" };
const insightLabel: CSSProperties = { fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 };
const sectionStyle: CSSProperties = { border: "1px solid var(--border)", borderRadius: 20, background: "var(--surface)", padding: 24, boxShadow: "var(--shadow-card)" };
const sectionTitle: CSSProperties = { margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" };
const sectionSub: CSSProperties   = { margin: "0 0 20px", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 };
const thStyle: CSSProperties      = { textAlign: "left", padding: "10px 12px", borderBottom: "2px solid var(--border)", color: "#475569", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 };
const tdStyle: CSSProperties      = { padding: "10px 12px", borderBottom: "1px solid var(--border)", fontSize: 14 };
const btnPrimary: CSSProperties    = { padding: "11px 20px", borderRadius: 14, border: "none", background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)", color: "white", fontWeight: 600, fontSize: 14, cursor: "pointer", boxShadow: "0 2px 14px rgba(37,99,235,0.35), 0 1px 2px rgba(0,0,0,0.08)" };
const btnSecondary: CSSProperties  = { padding: "11px 20px", borderRadius: 14, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--text)", fontWeight: 600, fontSize: 14, cursor: "pointer", boxShadow: "var(--shadow-xs)" };
const miniChartLabel: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 10 };
