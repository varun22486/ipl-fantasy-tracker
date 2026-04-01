export const dynamic = "force-dynamic";
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

async function getData(competitionId: number | null) {
  const [{ data: matches }, { data: settings }, { data: competitions }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").order("id", { ascending: false }),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    supabaseAdmin.from("competitions").select("*"),
  ]);

  let yourName: string;
  let opponentName: string;
  if (competitionId != null) {
    const comp = (competitions ?? []).find((c: any) => c.id === competitionId);
    yourName = comp?.player1_name ?? "Player 1";
    opponentName = comp?.player2_name ?? "Player 2";
  } else {
    yourName = (settings as any)?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  const playersQuery = supabaseAdmin.from("fantasy_players").select("*").order("id", { ascending: true });
  const { data: allPlayers } = competitionId != null
    ? await playersQuery.eq("competition_id", competitionId)
    : await playersQuery.is("competition_id", null);
  const rules = scoringFromSettings(settings as any);

  const playersByMatch: Record<number, FantasyPlayer[]> = {};
  for (const p of (allPlayers ?? []) as FantasyPlayer[]) {
    const mid = (p as any).match_id as number;
    if (!playersByMatch[mid]) playersByMatch[mid] = [];
    playersByMatch[mid].push(p);
  }

  const matchRows = (matches ?? []).map((m: any) => {
    const mp = playersByMatch[m.id] ?? [];
    const p1Side = competitionId != null ? yourName : "You";
    const yourPts = mp.filter((p) => p.side === p1Side).reduce((s, p) => s + playerPoints(p, rules).final, 0);
    const oppPts = mp.filter((p) => p.side !== p1Side).reduce((s, p) => s + playerPoints(p, rules).final, 0);
    const hasData = yourPts > 0 || oppPts > 0;
    const winner = !hasData ? null : yourPts > oppPts ? yourName : oppPts > yourPts ? opponentName : (yourPts > 0 ? "Tie" : null);
    return {
      matchId: m.id as number,
      fixture: formatFixture(m.fixture) || m.fixture || "TBD",
      date: m.match_date ?? "",
      yourPoints: yourPts,
      oppPoints: oppPts,
      winner,
      pointsDiff: Math.abs(yourPts - oppPts),
      hasData,
      isCurrent: Boolean(m.is_current),
      status: m.status ?? "",
    };
  });

  return { matchRows, yourName, opponentName };
}
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const competitionId = c ? Number(c) : null;
  const { matchRows, yourName, opponentName } = await getData(competitionId);
  const played = matchRows.filter((m) => m.hasData);

  return (
    <main className="page-main">
      <NavBar title="Match History" subtitle={`${played.length} completed · ${matchRows.length - played.length} upcoming`} />

      {matchRows.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, background: "white", border: "1px solid #e2e8f0", borderRadius: 20 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 8 }}>No matches yet</div>
          <div style={{ color: "#64748b", marginBottom: 24 }}>Link a match first to start tracking.</div>
          <Link href="/select" style={btnStyle}>Select Teams →</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {matchRows.map((m) => {
            const youWon = m.winner === yourName;
            const oppWon = m.winner === opponentName;
            const winnerName = m.winner;
            const totalPts = m.hasData ? m.yourPoints + m.oppPoints : 0;
            const youPct = totalPts > 0 ? Math.round((m.yourPoints / totalPts) * 100) : 50;

            return (
              <Link key={m.matchId} href={`/match/${m.matchId}`} style={{ textDecoration: "none" }}>
                <div className={`match-card${m.isCurrent ? " match-card--current" : ""}`}>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>{m.fixture}</div>
                      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                        {m.date || "—"}
                        {m.status && m.status !== "COMPLETED" && (
                          <span style={{ marginLeft: 8, padding: "1px 7px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: m.isCurrent ? "#dcfce7" : "#f1f5f9", color: m.isCurrent ? "#16a34a" : "#64748b" }}>
                            {m.isCurrent ? "● Live" : m.status}
                          </span>
                        )}
                      </div>
                    </div>
                    {m.hasData && winnerName && (
                      <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, flexShrink: 0, background: youWon ? YOU_LIGHT : oppWon ? OPP_LIGHT : "#fef9c3", color: youWon ? YOU_COLOR : oppWon ? OPP_COLOR : "#92400e" }}>
                        {m.winner === "Tie" ? "Tie" : `${winnerName} +${m.pointsDiff}`}
                      </span>
                    )}
                  </div>

                  {/* Scores */}
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
          <Link href="/match" style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>Go to Live Match →</Link>
        </div>
      )}
    </main>
  );
}

const btnStyle: CSSProperties = { padding: "10px 20px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", textDecoration: "none", fontWeight: 700, fontSize: 14, display: "inline-block" };
