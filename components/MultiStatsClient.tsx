"use client";

import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import Link from "next/link";

const COLORS = ["#2563eb","#dc2626","#16a34a","#d97706","#7c3aed","#0891b2","#db2777","#ea580c"];

type MatchStat = {
  matchId: number; fixture: string; date: string;
  pts: Record<string, number>; hasData: boolean; isCurrent: boolean; winner: string | null;
};
type Participant = { name: string; totalPoints: number; wins: number; matches: number };

type Props = {
  participants: Participant[];
  matchStats: MatchStat[];
  compPlayers: string[];
};

function shortFix(f: string) {
  const m = f.match(/match\s*(\d+)/i);
  return m ? `M${m[1]}` : f.slice(0, 6);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 14px", fontSize: 13, boxShadow: "0 4px 12px rgba(0,0,0,.08)" }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{payload[0]?.payload?.fixture ?? label}</div>
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: p.color ?? p.fill, display: "inline-block" }} />
          <span style={{ color: "#475569" }}>{p.name}:</span>
          <span style={{ fontWeight: 700 }}>{p.value} pts</span>
        </div>
      ))}
    </div>
  );
}

export default function MultiStatsClient({ participants, matchStats, compPlayers }: Props) {
  const played = matchStats.filter(m => m.hasData);

  // Build cumulative data for running total chart
  const cumulData = (() => {
    const running: Record<string, number> = {};
    for (const n of compPlayers) running[n] = 0;
    return matchStats.filter(m => m.hasData).map(m => {
      for (const n of compPlayers) running[n] = (running[n] ?? 0) + (m.pts[n] ?? 0);
      return { name: shortFix(m.fixture), fixture: m.fixture, ...Object.fromEntries(compPlayers.map(n => [n, running[n]])) };
    });
  })();

  // Per-match bar data
  const barData = played.map(m => ({
    name: shortFix(m.fixture), fixture: m.fixture,
    ...Object.fromEntries(compPlayers.map(n => [n, m.pts[n] ?? 0])),
  }));

  const panel: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 20, background: "white", padding: 22, boxShadow: "0 1px 3px rgba(15,23,42,.06)" };

  if (played.length === 0) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ textAlign: "center", padding: 60, ...panel }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>No scores yet</div>
          <div style={{ color: "#64748b", marginBottom: 20 }}>Each participant saves their lineup, then sync scores.</div>
          <Link href="/match" style={{ padding: "10px 20px", borderRadius: 12, background: "#0f172a", color: "white", textDecoration: "none", fontWeight: 700, fontSize: 14 }}>Go to Match</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>

      {/* ── Leaderboard ──────────────────────────────────────────────────────── */}
      <div style={panel}>
        <h2 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 800 }}>Standings</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {participants.map((p, i) => {
            const color = COLORS[compPlayers.indexOf(p.name) % COLORS.length];
            const pct = participants[0].totalPoints > 0 ? (p.totalPoints / participants[0].totalPoints) * 100 : 0;
            return (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 14, border: "1px solid #e2e8f0", background: i === 0 ? "#f8fafc" : "white" }}>
                <span style={{ fontWeight: 800, color: "#94a3b8", width: 24, textAlign: "center" }}>#{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color }}>{p.name}</div>
                  <div style={{ height: 5, borderRadius: 999, background: "#f1f5f9", marginTop: 6, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 999 }} />
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: 20 }}>{p.totalPoints}</div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>{p.wins}W · {p.matches} played</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Running total ────────────────────────────────────────────────────── */}
      {cumulData.length > 0 && (
        <div style={panel}>
          <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800 }}>Running Series Total</h2>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b" }}>Cumulative points — who&apos;s building the lead</p>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={cumulData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                {compPlayers.map((n, i) => (
                  <linearGradient key={n} id={`g${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
              <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {compPlayers.map((n, i) => (
                <Area key={n} type="monotone" dataKey={n} stroke={COLORS[i % COLORS.length]} strokeWidth={3}
                  fill={`url(#g${i})`} dot={{ r: 5, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }} activeDot={{ r: 7 }} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Per-match bars ───────────────────────────────────────────────────── */}
      {barData.length > 0 && (
        <div style={panel}>
          <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800 }}>Match-by-Match Points</h2>
          <p style={{ margin: "0 0 20px", fontSize: 13, color: "#64748b" }}>Points each participant scored per match</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {compPlayers.map((n, i) => (
                <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Match history table ───────────────────────────────────────────────── */}
      <div style={panel}>
        <h2 style={{ margin: "0 0 4px", fontSize: 17, fontWeight: 800 }}>Match Results</h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "#64748b" }}>Tap any match to see full player breakdown</p>
        <div style={{ display: "grid", gap: 8 }}>
          {matchStats.map(m => (
            <Link key={m.matchId} href={`/match/${m.matchId}`} style={{ textDecoration: "none" }}>
              <div className={`match-card${m.isCurrent ? " match-card--current" : ""}`}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{m.fixture}</div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{m.date || "—"}</div>
                  </div>
                  {m.hasData && m.winner && (
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 10px", borderRadius: 999, flexShrink: 0, background: m.winner === "Tie" ? "#fef9c3" : "#eff6ff", color: m.winner === "Tie" ? "#92400e" : "#2563eb" }}>
                      {m.winner === "Tie" ? "Tie" : `${m.winner} won`}
                    </span>
                  )}
                </div>
                {m.hasData && (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    {compPlayers.map((n, i) => (
                      <div key={n} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 999, background: COLORS[i % COLORS.length] }} />
                        <span style={{ fontSize: 12, color: "#475569" }}>{n}</span>
                        <span style={{ fontWeight: 800, fontSize: 15, color: m.winner === n ? COLORS[i % COLORS.length] : "#0f172a" }}>{m.pts[n] ?? 0}</span>
                      </div>
                    ))}
                  </div>
                )}
                {!m.hasData && <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>No scores yet</div>}
              </div>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
