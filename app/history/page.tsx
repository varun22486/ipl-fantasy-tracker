export const dynamic = "force-dynamic";
import { resolveCompetitionId } from "@/lib/competition";
export const revalidate = 0;

import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, fantasyPointsCounted, scoringFromSettings } from "@/lib/scoring";
import { formatFixture } from "@/lib/format";
import { isLiveMatchStatus } from "@/lib/next-match";
import NavBar from "@/components/NavBar";
import Link from "next/link";

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

function isFinishedMatchStatus(status: string): boolean {
  const u = status.toUpperCase();
  if (u === "COMPLETED") return true;
  if (u === "ABANDONED") return true;
  if (u.includes("NO RESULT")) return true;
  const low = status.toLowerCase();
  return low.includes("won by") || /\bbeat\b/.test(low) || low.includes("match tied") || low.includes("match drawn");
}

/** History: only live or finished — hide upcoming / SCHEDULED / DRAFT with no play data. */
function includeInHistory(m: HistoryMatchRow): boolean {
  if (m.isCurrent) return true;
  if (isLiveMatchStatus(m.status)) return true;
  if (isFinishedMatchStatus(m.status)) return true;
  if (m.hasData) return true;
  return false;
}

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
        ptsByPlayer[n] = mp.filter((p) => p.side === n).reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
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
      ? mp.filter((p) => p.side === yourName).reduce((s, p) => s + fantasyPointsCounted(p, rules), 0)
      : mp.filter((p) => p.side === "You").reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
    // Default league rows use side "You" vs anything else (not necessarily === settings.opponent_name).
    const oppPts =
      competitionId != null
        ? mp.filter((p) => p.side === opponentName).reduce((s, p) => s + fantasyPointsCounted(p, rules), 0)
        : mp.filter((p) => p.side !== "You").reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
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

  const compName = (comp as { name?: string } | null)?.name?.trim() || null;

  return { matchRows, yourName, opponentName, competitionId, isMulti, compPlayers, compName };
}

function matchHref(matchId: number, competitionId: number | null) {
  if (competitionId != null) return `/match/${matchId}?c=${competitionId}`;
  return `/match/${matchId}`;
}

function generateSelectionHref(competitionId: number | null) {
  return competitionId != null ? `/select?c=${competitionId}` : "/select";
}

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const { matchRows, yourName, opponentName, competitionId: cid, isMulti, compPlayers, compName } = await getData(competitionId);
  const visibleRows = matchRows.filter(includeInHistory);
  const played = visibleRows.filter((m) => m.hasData);
  const liveCount = visibleRows.filter((m) => m.isCurrent || isLiveMatchStatus(m.status)).length;

  const subtitle = isMulti
    ? `${compPlayers?.join(" · ")} · ${played.length} with scores · live & finished only`
    : `${played.length} with scores · live & finished only`;

  return (
    <main className="page-main history-page">
      <NavBar title="Match History" subtitle={subtitle} />

      {matchRows.length === 0 ? (
        <div className="history-empty">
          <div className="history-empty__icon" aria-hidden>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
              <rect x="9" y="3" width="6" height="4" rx="1" />
              <path d="M9 12h6M9 16h4" />
            </svg>
          </div>
          <h2 className="history-empty__title">No matches yet</h2>
          <p className="history-empty__text">Link a match first to start tracking.</p>
          <Link href={generateSelectionHref(cid)} className="history-empty__btn">
            Select teams
          </Link>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="history-empty history-empty--muted">
          <div className="history-empty__icon" aria-hidden>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
          <h2 className="history-empty__title">Nothing live or finished yet</h2>
          <p className="history-empty__text">
            Upcoming fixtures stay on Select. History lists matches in progress or completed.
          </p>
          <Link href={generateSelectionHref(cid)} className="history-empty__btn">
            Select match
          </Link>
        </div>
      ) : (
        <>
          <div className="history-summary" role="region" aria-label="History overview">
            {compName && (
              <div className="history-summary__card history-summary__card--accent">
                <div className="history-summary__label">Competition</div>
                <div className="history-summary__value history-summary__value--sm">{compName}</div>
              </div>
            )}
            <div className="history-summary__card">
              <div className="history-summary__label">In history</div>
              <div className="history-summary__value">{visibleRows.length}</div>
              <div className="history-summary__hint">live & finished</div>
            </div>
            <div className="history-summary__card">
              <div className="history-summary__label">With scores</div>
              <div className="history-summary__value">{played.length}</div>
              <div className="history-summary__hint">synced matches</div>
            </div>
            {liveCount > 0 && (
              <div className="history-summary__card history-summary__card--live">
                <div className="history-summary__label">Live now</div>
                <div className="history-summary__value">{liveCount}</div>
                <div className="history-summary__hint">open from list</div>
              </div>
            )}
          </div>
          <div className="history-list">
          {visibleRows.map((m) => {
            if (m.isMulti && m.ptsByPlayer && m.compPlayers) {
              const total = m.compPlayers.reduce((s, n) => s + (m.ptsByPlayer![n] ?? 0), 0);
              return (
                <Link key={m.matchId} href={matchHref(m.matchId, cid)} className="history-card-link">
                  <article className={`history-card history-card--multi${m.isCurrent ? " history-card--live" : ""}`}>
                    <div className="history-card__top">
                      <div className="history-card__titles">
                        <h3 className="history-card__fixture">{m.fixture}</h3>
                        <div className="history-card__meta">
                          <time dateTime={m.date}>{m.date || "—"}</time>
                          {m.status && m.status !== "COMPLETED" && (
                            <span className={`history-card__pill${m.isCurrent ? " history-card__pill--live" : ""}`}>
                              {m.isCurrent ? "Live" : m.status}
                            </span>
                          )}
                        </div>
                      </div>
                      {m.hasData && m.winner && (
                        <span
                          className={`history-card__winner${m.winner === "Tie" ? " history-card__winner--tie" : ""}`}
                        >
                          {m.winner === "Tie" ? "Tie" : `${m.winner} won`}
                        </span>
                      )}
                      <span className="history-card__chevron" aria-hidden>
                        →
                      </span>
                    </div>
                    {m.hasData ? (
                      <>
                        <div className="history-card__players history-card__players--multi">
                          {m.compPlayers.map((name, i) => {
                            const pts = m.ptsByPlayer![name] ?? 0;
                            const pct = total > 0 ? Math.round((pts / total) * 100) : 0;
                            const won = m.winner === name;
                            const color = MULTI_COLORS[i % MULTI_COLORS.length];
                            return (
                              <div key={name} className="history-card__player-chip">
                                <span className="history-card__swatch" style={{ background: color }} />
                                <span className="history-card__pname">{name}</span>
                                <span className="history-card__ppts" style={{ color: won ? color : undefined }}>
                                  {pts}
                                </span>
                                <span className="history-card__ppts-suffix">pts</span>
                                {total > 0 && <span className="history-card__ppct">{pct}%</span>}
                              </div>
                            );
                          })}
                        </div>
                        <div className="history-card__bar history-card__bar--multi">
                          {m.compPlayers.map((name, i) => {
                            const pts = m.ptsByPlayer![name] ?? 0;
                            const w = total > 0 ? (pts / total) * 100 : 100 / m.compPlayers!.length;
                            return (
                              <div
                                key={name}
                                className="history-card__bar-seg"
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
                      </>
                    ) : (
                      <p className="history-card__pending">Not yet played — open for details</p>
                    )}
                  </article>
                </Link>
              );
            }

            const youWon = m.winner === yourName;
            const oppWon = m.winner === opponentName;
            const winnerName = m.winner;
            const totalPts = m.hasData ? m.yourPoints + m.oppPoints : 0;
            const youPct = totalPts > 0 ? Math.round((m.yourPoints / totalPts) * 100) : 50;

            return (
              <Link key={m.matchId} href={matchHref(m.matchId, cid)} className="history-card-link">
                <article className={`history-card history-card--h2h${m.isCurrent ? " history-card--live" : ""}`}>
                  <div className="history-card__top">
                    <div className="history-card__titles">
                      <h3 className="history-card__fixture">{m.fixture}</h3>
                      <div className="history-card__meta">
                        <time dateTime={m.date}>{m.date || "—"}</time>
                        {m.status && m.status !== "COMPLETED" && (
                          <span className={`history-card__pill${m.isCurrent ? " history-card__pill--live" : ""}`}>
                            {m.isCurrent ? "Live" : m.status}
                          </span>
                        )}
                      </div>
                    </div>
                    {m.hasData && winnerName && (
                      <span
                        className={[
                          "history-card__winner",
                          "history-card__winner--h2h",
                          youWon ? "history-card__winner--you" : "",
                          oppWon ? "history-card__winner--opp" : "",
                          m.winner === "Tie" ? "history-card__winner--tie" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {m.winner === "Tie" ? "Tie" : `${winnerName} +${m.pointsDiff}`}
                      </span>
                    )}
                    <span className="history-card__chevron" aria-hidden>
                      →
                    </span>
                  </div>

                  {m.hasData ? (
                    <>
                      <div className="history-card__h2h">
                        <div className="history-card__side history-card__side--you">
                          <span className="history-card__dot" style={{ background: YOU_COLOR }} />
                          <span className="history-card__side-name">{yourName}</span>
                          <span className="history-card__side-pts" style={{ color: youWon ? YOU_COLOR : undefined }}>
                            {m.yourPoints}
                          </span>
                          <span className="history-card__side-unit">pts</span>
                        </div>
                        <span className="history-card__vs">vs</span>
                        <div className="history-card__side history-card__side--opp">
                          <span className="history-card__side-pts" style={{ color: oppWon ? OPP_COLOR : undefined }}>
                            {m.oppPoints}
                          </span>
                          <span className="history-card__side-unit">pts</span>
                          <span className="history-card__side-name">{opponentName}</span>
                          <span className="history-card__dot" style={{ background: OPP_COLOR }} />
                        </div>
                      </div>
                      <div className="history-card__scorebar">
                        <div
                          className="history-card__scorebar-fill"
                          style={{ width: `${youPct}%`, background: youWon ? YOU_COLOR : oppWon ? OPP_COLOR : "#94a3b8" }}
                        />
                      </div>
                    </>
                  ) : (
                    <p className="history-card__pending">Not yet played — open for details</p>
                  )}
                </article>
              </Link>
            );
          })}
          </div>
        </>
      )}

      {played.length === 0 && visibleRows.length > 0 && (
        <p className="history-footnote">
          No scores synced yet.{" "}
          <Link href={cid != null ? `/match?c=${cid}` : "/match"} className="history-footnote__link">
            Go to live match
          </Link>
        </p>
      )}
    </main>
  );
}

