"use client";

import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, ReferenceLine,
} from "recharts";
import type { CSSProperties } from "react";
import Link from "next/link";
import { outcomeForMultiParticipantMatch } from "@/lib/multi-participant-record";

const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#ea580c"];

type MatchStat = {
  matchId: number;
  fixture: string;
  date: string;
  pts: Record<string, number>;
  runs: Record<string, number>;
  wickets: Record<string, number>;
  catches: Record<string, number>;
  runouts: Record<string, number>;
  stumpings: Record<string, number>;
  captainPts: Record<string, number>;
  captainName: Record<string, string>;
  hasData: boolean;
  isCurrent: boolean;
  winner: string | null;
};

type Participant = {
  name: string;
  totalPoints: number;
  wins: number;
  losses: number;
  ties: number;
  matches: number;
};

type Props = {
  participants: Participant[];
  matchStats: MatchStat[];
  compPlayers: string[];
};

function shortFix(f: string) {
  const m = f.match(/match\s*(\d+)/i);
  return m ? `M${m[1]}` : f.slice(0, 6);
}

function colorFor(name: string, compPlayers: string[]) {
  return COLORS[compPlayers.indexOf(name) % COLORS.length];
}

function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <div style={{ fontWeight: 700, marginBottom: 6, color: "#0f172a" }}>{payload[0]?.payload?.fullName ?? payload[0]?.payload?.fixture ?? label}</div>
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

function StatCard({ label, value, sub, color, accent }: { label: string; value: string | number; sub?: string; color?: string; accent?: string }) {
  return (
    <div className="ui-card" style={{ borderTop: accent ? `3px solid ${accent}` : undefined }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: color ?? "#0f172a" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function computeMultiInsights(played: MatchStat[], compPlayers: string[]) {
  if (played.length === 0) return null;

  let best = { name: "", pts: 0, fixture: "" };
  for (const m of played) {
    for (const n of compPlayers) {
      const v = m.pts[n] ?? 0;
      if (v > best.pts) best = { name: n, pts: v, fixture: m.fixture };
    }
  }

  let closest = played[0];
  let closestSpread = Infinity;
  for (const m of played) {
    const vals = compPlayers.map((n) => m.pts[n] ?? 0);
    const spread = Math.max(...vals) - Math.min(...vals);
    if (spread < closestSpread) {
      closestSpread = spread;
      closest = m;
    }
  }

  const avgs: Record<string, number> = {};
  for (const n of compPlayers) {
    avgs[n] = Math.round(played.reduce((s, m) => s + (m.pts[n] ?? 0), 0) / played.length);
  }
  const sortedByAvg = [...compPlayers].sort((a, b) => (avgs[b] ?? 0) - (avgs[a] ?? 0));

  const lastWinner = played[played.length - 1]?.winner;
  let streak = 1;
  for (let i = played.length - 2; i >= 0; i--) {
    if (played[i].winner === lastWinner && lastWinner && lastWinner !== "Tie") streak++;
    else break;
  }

  return { best, closest, closestSpread, avgs, sortedByAvg, streak, lastWinner };
}

export default function MultiStatsClient({ participants, matchStats, compPlayers }: Props) {
  const played = matchStats.filter((m) => m.hasData);
  const ins = computeMultiInsights(played, compPlayers);
  const leader = participants[0]?.name ?? compPlayers[0];

  const cumulData = (() => {
    const running: Record<string, number> = {};
    for (const n of compPlayers) running[n] = 0;
    return played.map((m) => {
      for (const n of compPlayers) running[n] = (running[n] ?? 0) + (m.pts[n] ?? 0);
      return {
        name: shortFix(m.fixture),
        fullName: m.fixture,
        fixture: m.fixture,
        ...Object.fromEntries(compPlayers.map((n) => [n, running[n]])),
      };
    });
  })();

  const barData = played.map((m) => ({
    name: shortFix(m.fixture),
    fullName: m.fixture,
    fixture: m.fixture,
    ...Object.fromEntries(compPlayers.map((n) => [n, m.pts[n] ?? 0])),
  }));

  const buildStatRows = (key: keyof Pick<MatchStat, "runs" | "wickets" | "catches" | "runouts" | "stumpings" | "captainPts">) => {
    const perMatch = played.map((m) => ({
      name: shortFix(m.fixture),
      fullName: m.fixture,
      fixture: m.fixture,
      ...Object.fromEntries(compPlayers.map((n) => [n, m[key][n] ?? 0])),
    }));
    const running = played.map((m, i) => {
      const slice = played.slice(0, i + 1);
      return {
        name: shortFix(m.fixture),
        fullName: m.fixture,
        fixture: m.fixture,
        ...Object.fromEntries(
          compPlayers.map((n) => [
            n,
            slice.reduce((s, x) => s + (x[key][n] ?? 0), 0),
          ])
        ),
      };
    });
    return { perMatch, running };
  };

  const runsCharts = buildStatRows("runs");
  const wicketsCharts = buildStatRows("wickets");
  const catchesCharts = buildStatRows("catches");
  const runoutsCharts = buildStatRows("runouts");
  const stumpingsCharts = buildStatRows("stumpings");
  const capCharts = buildStatRows("captainPts");

  const winRateData =
    played.length >= 2
      ? played.map((m, i) => {
          const slice = played.slice(0, i + 1);
          const row: Record<string, string | number> = {
            name: shortFix(m.fixture),
            fullName: m.fixture,
            fixture: m.fixture,
          };
          for (const n of compPlayers) {
            let w = 0;
            let t = 0;
            for (const x of slice) {
              const o = outcomeForMultiParticipantMatch(x, n, compPlayers);
              if (o === "win") w += 1;
              else if (o === "tie") t += 1;
            }
            const games = slice.length;
            row[n] = games > 0 ? Math.round(((w + 0.5 * t) / games) * 100) : 0;
          }
          return row;
        })
      : [];

  const RANGES = [
    { label: "0–49", min: 0, max: 49 },
    { label: "50–99", min: 50, max: 99 },
    { label: "100–149", min: 100, max: 149 },
    { label: "150–199", min: 150, max: 199 },
    { label: "200+", min: 200, max: 9999 },
  ];
  const rangeData = RANGES.map(({ label, min, max }) => ({
    range: label,
    ...Object.fromEntries(
      compPlayers.map((n) => [
        n,
        played.filter((m) => {
          const v = m.pts[n] ?? 0;
          return v >= min && v <= max;
        }).length,
      ])
    ),
  }));

  const panel: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 20,
    background: "var(--surface)",
    padding: 24,
    boxShadow: "var(--shadow-card)",
  };

  if (matchStats.length === 0) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Insights & charts</h2>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748b" }}>{compPlayers.join(" · ")}</p>
        </div>
        <div style={{ textAlign: "center", padding: 60, ...panel }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No matches yet</div>
          <div style={{ color: "#64748b", marginBottom: 24 }}>Link a match and save lineups to get started.</div>
          <Link href="/match" style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>
            Go to Match
          </Link>
        </div>
      </div>
    );
  }

  if (played.length === 0) {
    return (
      <div style={{ display: "grid", gap: 24 }}>
        <div style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Insights & charts</h2>
          <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748b" }}>{compPlayers.join(" · ")}</p>
        </div>
        <div style={{ textAlign: "center", padding: 60, ...panel }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>No scores yet</div>
          <div style={{ color: "#64748b", marginBottom: 20 }}>Sync scores after each match to see charts.</div>
          <Link href="/match" style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>
            Go to Match
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Insights & charts</h2>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "#64748b" }}>{compPlayers.join(" · ")}</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 14 }}>
        {participants.map((p) => (
          <StatCard
            key={p.name}
            label={`${p.name} total`}
            value={p.totalPoints}
            sub={`${p.wins}W · ${p.losses}L${p.ties > 0 ? ` · ${p.ties}T` : ""} · ${p.matches} gp`}
            color={colorFor(p.name, compPlayers)}
            accent={colorFor(p.name, compPlayers)}
          />
        ))}
        <StatCard label="Leader" value={leader} sub={participants.length > 1 ? `${participants[0].totalPoints} pts` : "—"} />
        <StatCard label="Matches" value={matchStats.length} sub={`${played.length} synced`} />
      </div>

      {ins && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 12 }}>
          <div className="insight-card insight-card--blue">
            <div style={insightLabel}>Form (last match)</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 8, color: "#0f172a" }}>
              {ins.lastWinner === "Tie" ? "Tie" : ins.lastWinner ? `${ins.lastWinner} won` : "—"}
            </div>
            {ins.streak >= 2 && ins.lastWinner && ins.lastWinner !== "Tie" && (
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: "#334155" }}>
                {ins.lastWinner} — {ins.streak} in a row
              </div>
            )}
          </div>
          <div className="insight-card insight-card--teal">
            <div style={insightLabel}>Avg / match (top)</div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {ins.sortedByAvg.slice(0, 3).map((n) => (
                <div key={n} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: colorFor(n, compPlayers) }}>{n}</span>
                  <span style={{ fontWeight: 800 }}>{ins.avgs[n]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="insight-card insight-card--amber">
            <div style={insightLabel}>Best single match</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: colorFor(ins.best.name, compPlayers), marginTop: 6, lineHeight: 1 }}>
              {ins.best.pts}
              <span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}> pts</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, marginTop: 4 }}>{ins.best.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ins.best.fixture}</div>
          </div>
          <div className="insight-card insight-card--red">
            <div style={insightLabel}>Closest match</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#d97706", marginTop: 6, lineHeight: 1 }}>
              {ins.closestSpread}
              <span style={{ fontSize: 13, fontWeight: 500, color: "#64748b" }}> pt spread</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{ins.closest.fixture}</div>
          </div>
        </div>
      )}

      {/* Points */}
      <div style={panel}>
        <h2 style={sectionTitle}>Running Series Total</h2>
        <p style={sectionSub}>Cumulative fantasy points by match</p>
        <ResponsiveContainer width="100%" height={270}>
          <AreaChart data={cumulData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <defs>
              {compPlayers.map((n, i) => (
                <linearGradient key={n} id={`gPts${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} />
            <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
            <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} pts`} />} />
            <Legend wrapperStyle={{ fontSize: 13 }} />
            {compPlayers.map((n, i) => (
              <Area
                key={n}
                type="monotone"
                dataKey={n}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={3}
                fill={`url(#gPts${i})`}
                dot={{ r: 5, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                activeDot={{ r: 7 }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        <div style={{ marginTop: 24 }}>
          <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Match-by-Match</h2>
          <p style={sectionSub}>Points per match</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} pts`} />} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {compPlayers.map((n, i) => (
                <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Runs & wickets */}
      <div style={panel}>
        <h2 style={sectionTitle}>Runs</h2>
        <p style={sectionSub}>Per-match and cumulative series runs per participant</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20 }}>
          <div>
            <div style={miniChartLabel}>Per match</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={runsCharts.perMatch} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} runs`} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {compPlayers.map((n, i) => (
                  <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={miniChartLabel}>Cumulative total</div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={runsCharts.running} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  {compPlayers.map((n, i) => (
                    <linearGradient key={n} id={`gRun${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} runs`} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {compPlayers.map((n, i) => (
                  <Area
                    key={n}
                    type="monotone"
                    dataKey={n}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2.5}
                    fill={`url(#gRun${i})`}
                    dot={{ r: 4, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={{ marginTop: 24 }}>
          <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Wickets</h2>
          <p style={sectionSub}>Per-match and cumulative wickets</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20 }}>
            <div>
              <div style={miniChartLabel}>Per match</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={wicketsCharts.perMatch} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} wkt${v !== 1 ? "s" : ""}`} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div style={miniChartLabel}>Cumulative total</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={wicketsCharts.running} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    {compPlayers.map((n, i) => (
                      <linearGradient key={n} id={`gWkt${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} wkt${v !== 1 ? "s" : ""}`} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Area
                      key={n}
                      type="monotone"
                      dataKey={n}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2.5}
                      fill={`url(#gWkt${i})`}
                      dot={{ r: 4, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Catches & captain */}
      <div style={panel}>
        <h2 style={sectionTitle}>Catches</h2>
        <p style={sectionSub}>Per-match and cumulative catches</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20 }}>
          <div>
            <div style={miniChartLabel}>Per match</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={catchesCharts.perMatch} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} catch${v !== 1 ? "es" : ""}`} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {compPlayers.map((n, i) => (
                  <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <div style={miniChartLabel}>Cumulative total</div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={catchesCharts.running} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  {compPlayers.map((n, i) => (
                    <linearGradient key={n} id={`gCt${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.18} />
                      <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} catch${v !== 1 ? "es" : ""}`} />} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {compPlayers.map((n, i) => (
                  <Area
                    key={n}
                    type="monotone"
                    dataKey={n}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2.5}
                    fill={`url(#gCt${i})`}
                    dot={{ r: 4, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div style={{ marginTop: 24 }}>
          <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Run-outs (fielding)</h2>
          <p style={sectionSub}>Per-match and cumulative run-out credits per participant</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20 }}>
            <div>
              <div style={miniChartLabel}>Per match</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={runoutsCharts.perMatch} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} credit${v !== 1 ? "s" : ""}`} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div style={miniChartLabel}>Cumulative total</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={runoutsCharts.running} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    {compPlayers.map((n, i) => (
                      <linearGradient key={n} id={`gRO${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} credit${v !== 1 ? "s" : ""}`} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Area
                      key={n}
                      type="monotone"
                      dataKey={n}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2.5}
                      fill={`url(#gRO${i})`}
                      dot={{ r: 4, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 24 }}>
          <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Stumpings (WK)</h2>
          <p style={sectionSub}>Per-match and cumulative stumpings per participant</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20 }}>
            <div>
              <div style={miniChartLabel}>Per match</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stumpingsCharts.perMatch} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} stump${v !== 1 ? "s" : ""}`} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div style={miniChartLabel}>Cumulative total</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={stumpingsCharts.running} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    {compPlayers.map((n, i) => (
                      <linearGradient key={n} id={`gST${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} stump${v !== 1 ? "s" : ""}`} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Area
                      key={n}
                      type="monotone"
                      dataKey={n}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2.5}
                      fill={`url(#gST${i})`}
                      dot={{ r: 4, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 24 }}>
          <h2 style={{ ...sectionTitle, fontSize: 15, marginBottom: 4 }}>Captain points</h2>
          <p style={sectionSub}>Per-match captain fantasy points and cumulative total (names in tooltip)</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 20 }}>
            <div>
              <div style={miniChartLabel}>Per match</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={played.map((m) => {
                  const row: Record<string, unknown> = {
                    name: shortFix(m.fixture),
                    fullName: m.fixture,
                    fixture: m.fixture,
                  };
                  for (const n of compPlayers) {
                    row[n] = m.captainPts[n] ?? 0;
                    row[`${n}__cap`] = m.captainName[n] ?? "—";
                  }
                  return row;
                })} margin={{ top: 5, right: 16, left: 0, bottom: 0 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    content={({ active, payload, label: lbl }: any) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="chart-tooltip">
                          <div style={{ fontWeight: 700, marginBottom: 8, color: "#0f172a" }}>{d?.fullName ?? lbl}</div>
                          {payload.map((p: any, i: number) => {
                            const capKey = `${p.dataKey}__cap`;
                            const capName = d?.[capKey] ?? "—";
                            return (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                                <span style={{ width: 10, height: 10, borderRadius: 2, background: p.fill, display: "inline-block" }} />
                                <span style={{ color: "#475569" }}>{p.name}:</span>
                                <span style={{ fontWeight: 700 }}>{p.value} pts</span>
                                <span style={{ color: "#94a3b8", fontSize: 12 }}>({capName})</span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div style={miniChartLabel}>Cumulative total</div>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={capCharts.running} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    {compPlayers.map((n, i) => (
                      <linearGradient key={n} id={`gCap${i}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.18} />
                        <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} pts`} />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {compPlayers.map((n, i) => (
                    <Area
                      key={n}
                      type="monotone"
                      dataKey={n}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2.5}
                      fill={`url(#gCap${i})`}
                      dot={{ r: 4, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>

      {/* Win rate + distribution */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 20 }}>
        {winRateData.length > 0 && (
          <div style={panel}>
            <h2 style={sectionTitle}>Win rate over time</h2>
            <p style={sectionSub}>Rolling win % after each match (clear win only)</p>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={winRateData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <defs>
                  {compPlayers.map((n, i) => (
                    <linearGradient key={n} id={`gWin${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0.12} />
                      <stop offset="95%" stopColor={COLORS[i % COLORS.length]} stopOpacity={0} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} tickFormatter={(v: number) => `${v}%`} axisLine={false} tickLine={false} />
                <ReferenceLine y={50} stroke="#cbd5e1" strokeDasharray="4 3" label={{ value: "50%", fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip content={<ChartTooltip formatter={(v: number) => `${v}%`} />} />
                <Legend wrapperStyle={{ fontSize: 13 }} />
                {compPlayers.map((n, i) => (
                  <Area
                    key={n}
                    type="monotone"
                    dataKey={n}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2.5}
                    fill={`url(#gWin${i})`}
                    dot={{ r: 4, fill: COLORS[i % COLORS.length], stroke: "white", strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div style={panel}>
          <h2 style={sectionTitle}>Score distribution</h2>
          <p style={sectionSub}>How often each participant finished in each points bracket</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={rangeData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="range" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} label={{ value: "matches", angle: -90, position: "insideLeft", fontSize: 11, fill: "#94a3b8" }} />
              <Tooltip content={<ChartTooltip formatter={(v: number) => `${v} match${v !== 1 ? "es" : ""}`} />} />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              {compPlayers.map((n, i) => (
                <Bar key={n} dataKey={n} fill={COLORS[i % COLORS.length]} radius={[6, 6, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

const insightLabel: CSSProperties = { fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 };
const sectionTitle: CSSProperties = { margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#0f172a" };
const sectionSub: CSSProperties = { margin: "0 0 20px", fontSize: 13, color: "#64748b" };
const miniChartLabel: CSSProperties = { fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 10 };
const btnPrimary: CSSProperties = {
  padding: "11px 20px",
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
  color: "white",
  fontWeight: 600,
  fontSize: 14,
  cursor: "pointer",
  boxShadow: "0 2px 14px rgba(37,99,235,0.35), 0 1px 2px rgba(0,0,0,0.08)",
};
