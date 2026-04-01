export const dynamic = "force-dynamic";
import { resolveCompetitionId } from "@/lib/competition";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, playerPoints, scoringFromSettings } from "@/lib/scoring";
import { formatFixture } from "@/lib/format";
import NavBar from "@/components/NavBar";
import Link from "next/link";
import type { CSSProperties } from "react";

const YOU_COLOR = "#2563eb";
const OPP_COLOR = "#dc2626";
const YOU_LIGHT = "#dbeafe";
const OPP_LIGHT = "#fee2e2";
const MULTI_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#ea580c"];

type HistoryMatchRow = {
  matchId: number;
  fixture: string;
  date: string;
  hasData: boolean;
  isCurrent: boolean;
  status: string;
  isMulti: boolean;
  winner: string | null;
  yourPoints: number;
  oppPoints: number;
  yourName: string;
  opponentName: string;
  pointsDiff: number;
  /** 3+ players: per-participant points */
  ptsByPlayer?: Record<string, number>;
  compPlayers?: string[];
};

async function getData(competitionId: number | null) {
  const [{ data: matches }, { data: settings }, { data: competitions }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("competitions").select("*"),
  ]);

  const comp = competitionId != null ? (competitions ?? []).find((c: { id: number }) => c.id === competitionId) : null;
  const compPlayers: string[] = comp
    ? Array.isArray(comp.players)
      ? (comp.players as string[])
      : [comp.player1_name, comp.player2_name].filter(Boolean)
    : [];
  const isMulti = compPlayers.length > 2;

  let yourName: string;
  let opponentName: string;
  if (comp) {
    yourName = compPlayers[0] ?? "Player 1";
    opponentName = compPlayers[1] ?? "Player 2";
  } else {
    yourName = (settings as { your_name?: string })?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  const playersQuery = supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true });
  const { data: allPlayers } =
    competitionId != null
      ? await playersQuery.eq("competition_id", competitionId)
      : await playersQuery.is("competition_id", null);
  const rules = scoringFromSettings(settings as Record<string, unknown>);

  const playersByMatch: Record<number, FantasyPlayer[]> = {};
  for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
    const mid = (p as { match_id: number }).match_id;
    if (!playersByMatch[mid]) playersByMatch[mid] = [];
    playersByMatch[mid].push(p);
  }

  const matchRows: HistoryMatchRow[] = (matches ?? []).map((m: { id: number; fixture?: string; match_date?: string; is_current?: boolean; status?: string }) => {
    const mp = playersByMatch[m.id] ?? [];

    if (isMulti) {
      const ptsByPlayer: Record<string, number> = {};
      for (const n of compPlayers) {
        ptsByPlayer[n] = mp.filter((p) => p.side === n).reduce((s, p) => s + playerPoints(p, rules).final, 0);
      }
      const hasData = Object.values(ptsByPlayer).some((v) => v > 0);
      const maxPts = Math.max(0, ...Object.values(ptsByPlayer));
      const leaders = compPlayers.filter((n) => ptsByPlayer[n] === maxPts && maxPts > 0);
      const winner = !hasData ? null : leaders.length === 1 ? leaders[0]! : "Tie";
      const sorted = [...compPlayers].sort((a, b) => (ptsByPlayer[b] ?? 0) - (ptsByPlayer[a] ?? 0));
      const top = sorted[0] ?? "";
      const second = sorted[1] ?? top;
      const pointsDiff = hasData ? (ptsByPlayer[top] ?? 0) - (ptsByPlayer[second] ?? 0) : 0;
      return {
        matchId: m.id,
        fixture: formatFixture(m.fixture) || m.fixture || "TBD",
        date: m.match_date ?? "",
        hasData,
        isCurrent: Boolean(m.is_current),
        status: m.status ?? "",
        isMulti: true,
        winner,
        yourPoints: ptsByPlayer[yourName] ?? 0,
        oppPoints: ptsByPlayer[opponentName] ?? 0,
        yourName,
        opponentName,
        pointsDiff,
        ptsByPlayer,
        compPlayers: [...compPlayers],
      };
    }

    const yourPts = competitionId != null
      ? mp.filter((p) => p.side === yourName).reduce((s, p) => s + playerPoints(p, rules).final, 0)
      : mp.filter((p) => p.side === "You").reduce((s, p) => s + playerPoints(p, rules).final, 0);
    // Default league rows use side "You" vs anything else (not necessarily === settings.opponent_name).
    const oppPts =
      competitionId != null
        ? mp.filter((p) => p.side === opponentName).reduce((s, p) => s + playerPoints(p, rules).final, 0)
        : mp.filter((p) => p.side !== "You").reduce((s, p) => s + playerPoints(p, rules).final, 0);
    const hasData = yourPts > 0 || oppPts > 0;
    const winner = !hasData ? null : yourPts > oppPts ? yourName : oppPts > yourPts ? opponentName : yourPts > 0 || oppPts > 0 ? "Tie" : null;

    return {
      matchId: m.id,
      fixture: formatFixture(m.fixture) || m.fixture || "TBD",
      date: m.match_date ?? "",
      hasData,
      isCurrent: Boolean(m.is_current),
      status: m.status ?? "",
      isMulti: false,
      winner,
      yourPoints: yourPts,
      oppPoints: oppPts,
      yourName,
      opponentName,
      pointsDiff: Math.abs(yourPts - oppPts),
    };
  });

  return { matchRows, yourName, opponentName, competitionId, isMulti, compPlayers };
}

function matchHref(matchId: number, competitionId: number | null) {
  if (competitionId != null) return `/match/${matchId}?c=${competitionId}`;
  return `/match/${matchId}`;
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const { matchRows, yourName, opponentName, competitionId: cid, isMulti, compPlayers } = await getData(competitionId);
  const played = matchRows.filter((m) => m.hasData);

  const subtitle = isMulti
    ? `${compPlayers?.join(" · ")} · ${played.length} completed · ${matchRows.length - played.length} upcoming`
    : `${played.length} completed · ${matchRows.length - played.length} upcoming`;

  return (
    <main className="page-main">
      <NavBar title="Match History" subtitle={subtitle} />

      {matchRows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: "white", border: "1px solid #e2e8f0", borderRadius: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>No matches yet</div>
          <div style={{ color: "#64748b", marginBottom: 24 }}>Link a match first to start tracking.</div>
          <Link href={cid != null ? `/select?c=${cid}` : "/select"} style={btnStyle}>
            Select Teams →
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {matchRows.map((m) => {
            if (m.isMulti && m.ptsByPlayer && m.compPlayers) {
              const total = m.compPlayers.reduce((s, n) => s + (m.ptsByPlayer![n] ?? 0), 0);
              return (
                <Link key={m.matchId} href={matchHref(m.matchId, cid)} style={{ textDecoration: "none" }}>
                  <div className={`match-card${m.isCurrent ? " match-card--current" : ""}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{m.fixture}</div>
                        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                          {m.date || "—"}
                          {m.status && m.status !== "COMPLETED" && (
                            <span
                              style={{
                                marginLeft: 8,
                                padding: "1px 7px",
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 700,
                                background: m.isCurrent ? "#dcfce7" : "#f1f5f9",
                                color: m.isCurrent ? "#16a34a" : "#64748b",
                              }}
                            >
                              {m.isCurrent ? "● Live" : m.status}
                            </span>
                          )}
                        </div>
                      </div>
                      {m.hasData && m.winner && (
                        <span
                          style={{
                            padding: "3px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            flexShrink: 0,
                            background: m.winner === "Tie" ? "#fef9c3" : "#eff6ff",
                            color: m.winner === "Tie" ? "#92400e" : "#2563eb",
                          }}
                        >
                          {m.winner === "Tie" ? "Tie" : `${m.winner} won`}
                        </span>
                      )}
                    </div>
                    {m.hasData ? (
                      <>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10, alignItems: "center" }}>
                          {m.compPlayers.map((name, i) => {
                            const pts = m.ptsByPlayer![name] ?? 0;
                            const pct = total > 0 ? Math.round((pts / total) * 100) : 0;
                            const won = m.winner === name;
                            const color = MULTI_COLORS[i % MULTI_COLORS.length];
                            return (
                              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
                                <div style={{ width: 8, height: 8, borderRadius: 999, background: color }} />
                                <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{name}</span>
                                <span style={{ fontSize: 18, fontWeight: 800, color: won ? color : "#0f172a" }}>{pts}</span>
                                <span style={{ fontSize: 11, color: "#94a3b8" }}>pts</span>
                                {total > 0 && <span style={{ fontSize: 11, color: "#cbd5e1" }}>({pct}%)</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="score-bar" style={{ marginTop: 10 }}>
                          <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "#f1f5f9" }}>
                            {m.compPlayers.map((name, i) => {
                              const pts = m.ptsByPlayer![name] ?? 0;
                              const w = total > 0 ? (pts / total) * 100 : 100 / m.compPlayers!.length;
                              return (
                                <div
                                  key={name}
                                  style={{
                                    width: `${w}%`,
                                    background: MULTI_COLORS[i % MULTI_COLORS.length],
                                    minWidth: pts > 0 ? 4 : 0,
                                  }}
                                  title={`${name}: ${pts}`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic", marginTop: 8 }}>
                        Not yet played — tap to view details
                      </div>
                    )}
                  </div>
                </Link>
              );
            }

            const youWon = m.winner === yourName;
            const oppWon = m.winner === opponentName;
            const winnerName = m.winner;
            const totalPts = m.hasData ? m.yourPoints + m.oppPoints : 0;
            const youPct = totalPts > 0 ? Math.round((m.yourPoints / totalPts) * 100) : 50;

            return (
              <Link key={m.matchId} href={matchHref(m.matchId, cid)} style={{ textDecoration: "none" }}>
                <div className={`match-card${m.isCurrent ? " match-card--current" : ""}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{m.fixture}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                        {m.date || "—"}
                        {m.status && m.status !== "COMPLETED" && (
                          <span
                            style={{
                              marginLeft: 8,
                              padding: "1px 7px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              background: m.isCurrent ? "#dcfce7" : "#f1f5f9",
                              color: m.isCurrent ? "#16a34a" : "#64748b",
                            }}
                          >
                            {m.isCurrent ? "● Live" : m.status}
                          </span>
                        )}
                      </div>
                    </div>
                    {m.hasData && winnerName && (
                      <span
                        style={{
                          padding: "3px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          flexShrink: 0,
                          background: youWon ? YOU_LIGHT : oppWon ? OPP_LIGHT : "#fef9c3",
                          color: youWon ? YOU_COLOR : oppWon ? OPP_COLOR : "#92400e",
                        }}
                      >
                        {m.winner === "Tie" ? "Tie" : `${winnerName} +${m.pointsDiff}`}
                      </span>
                    )}
                  </div>

                  {m.hasData ? (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 999, background: YOU_COLOR }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{yourName}</span>
                          <span style={{ fontSize: 22, fontWeight: 800, color: youWon ? YOU_COLOR : "#0f172a" }}>{m.yourPoints}</span>
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>pts</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 700 }}>vs</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row-reverse" as const }}>
                          <div style={{ width: 8, height: 8, borderRadius: 999, background: OPP_COLOR }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>{opponentName}</span>
                          <span style={{ fontSize: 22, fontWeight: 800, color: oppWon ? OPP_COLOR : "#0f172a" }}>{m.oppPoints}</span>
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>pts</span>
                        </div>
                      </div>
                      <div className="score-bar">
                        <div className="score-bar__fill" style={{ width: `${youPct}%`, background: youWon ? YOU_COLOR : oppWon ? OPP_COLOR : "#94a3b8" }} />
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>
                      Not yet played — tap to view details
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {played.length === 0 && matchRows.length > 0 && (
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          No scores synced yet.{" "}
          <Link href={cid != null ? `/match?c=${cid}` : "/match"} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
            Go to Live Match →
          </Link>
        </div>
      )}
    </main>
  );
}

const btnStyle: CSSProperties = {
  padding: "10px 20px",
  borderRadius: 12,
  border: "1px solid #0f172a",
  background: "#0f172a",
  color: "white",
  textDecoration: "none",
  fontWeight: 700,
  fontSize: 14,
  display: "inline-block",
};
