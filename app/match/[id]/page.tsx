export const dynamic = "force-dynamic";
export const revalidate = 0;

import { resolveCompetitionId } from "@/lib/competition";
import { supabaseAdmin } from "@/lib/supabase-admin";
import {
  FantasyPlayer,
  displayRunMilestoneCells,
  fantasyPointsCounted,
  formatCtRoSt,
  hasCenturyRunMilestone,
  isFantasyBench,
  playerPoints,
  scoringFromSettings,
  sortFantasyLineupForDisplay,
} from "@/lib/scoring";
import { formatFixture } from "@/lib/format";
import { isPointsVoidedMatchStatus } from "@/lib/match-void";
import {
  DEFAULT_LINEUP_LATENESS_POINTS,
  hasLineupLatenessActive,
  lateParticipantsList,
  lineupLatenessSideAdjustment,
  matchLineupForCompetition,
} from "@/lib/lineup-lateness";
import NavBar from "@/components/NavBar";
import SyncButton from "@/components/SyncButton";
import ScoreEditor from "@/components/ScoreEditor";
import MatchDetailLineupEditor from "@/components/MatchDetailLineupEditor";
import VoidMatchControl from "@/components/VoidMatchControl";
import LineupLatenessControl from "@/components/LineupLatenessControl";
import Link from "next/link";
import { formatRelativeTimeAgo, formatUiDateTime } from "@/lib/ui-time";

type SquadTeam = { teamName: string; players: string[] };

function parseRoster(matchRow: unknown): { rosterNames: string[]; squads: SquadTeam[]; nameToId: Record<string, string> } {
  if (!matchRow || typeof matchRow !== "object") return { rosterNames: [], squads: [], nameToId: {} };
  const raw = (matchRow as { provider_squad_json?: unknown }).provider_squad_json;
  if (!raw || typeof raw !== "object") return { rosterNames: [], squads: [], nameToId: {} };
  const o = raw as { squads?: unknown; rosterNames?: unknown; nameToId?: unknown };
  const squads = Array.isArray(o.squads)
    ? (o.squads as any[])
        .filter((t) => t && typeof t === "object")
        .map((t) => ({
          teamName: typeof t.teamName === "string" ? t.teamName : "Team",
          players: Array.isArray(t.players) ? t.players.filter((p: any) => typeof p === "string" && p.trim()) : [],
        }))
        .filter((t) => t.players.length > 0)
    : [];
  let rosterNames = Array.isArray(o.rosterNames) ? o.rosterNames.filter((n: any) => typeof n === "string" && n.trim()) : [];
  if (rosterNames.length === 0 && squads.length > 0) {
    const s = new Set<string>();
    for (const t of squads) for (const p of t.players) s.add(p.trim());
    rosterNames = [...s].sort((a, b) => a.localeCompare(b));
  }
  const nameToId = o.nameToId && typeof o.nameToId === "object" && !Array.isArray(o.nameToId) ? (o.nameToId as Record<string, string>) : {};
  return { rosterNames, squads, nameToId };
}

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
};

const MULTI_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#ea580c"];

const TABLE_HEAD = ["Player", "Runs", "Wkts", "CT/RO/ST", "Bonuses", "Points", ""] as const;

async function getData(matchId: number, competitionId: number | null) {
  const playersBase = supabaseAdmin.from("fantasy_players").select("*").eq("match_id", matchId).order("id", { ascending: true });
  const { data: players } =
    competitionId != null
      ? await playersBase.eq("competition_id", competitionId)
      : await playersBase.is("competition_id", null);

  const [{ data: match }, { data: settings }, { data: comp }] = await Promise.all([
    supabaseAdmin.from("matches").select("*").eq("id", matchId).single(),
    supabaseAdmin.from("series_settings").select("*").limit(1).single(),
    competitionId != null
      ? supabaseAdmin.from("competitions").select("*").eq("id", competitionId).single()
      : Promise.resolve({ data: null as { players?: string[]; player1_name?: string; player2_name?: string } | null }),
  ]);

  const compPlayers: string[] =
    comp && Array.isArray(comp.players)
      ? comp.players
      : comp
        ? ([comp.player1_name, comp.player2_name].filter(Boolean) as string[])
        : [];

  let yourName: string;
  let opponentName: string;
  if (comp) {
    yourName = compPlayers[0] ?? "Player 1";
    opponentName = compPlayers[1] ?? "Player 2";
  } else {
    yourName = (settings as { your_name?: string })?.your_name ?? "Varun";
    opponentName = settings?.opponent_name ?? "Rahul";
  }

  const rules = scoringFromSettings(settings as Record<string, unknown>);
  const list = (players ?? []) as FantasyPlayer[];
  const isMulti = compPlayers.length > 2;

  return {
    match,
    players: list,
    yourName,
    opponentName,
    compPlayers,
    isMulti,
    rules,
    competitionId,
  };
}

function PlayerRow({
  p,
  rules,
  displaySide,
  pointsVoided,
}: {
  p: FantasyPlayer;
  rules: ReturnType<typeof scoringFromSettings>;
  displaySide: string;
  pointsVoided?: boolean;
}) {
  const pts = playerPoints(p, rules);
  const counted = pointsVoided ? 0 : fantasyPointsCounted(p, rules);
  const runMile = displayRunMilestoneCells(p);
  const noBonuses =
    !p.catches &&
    runMile.fifty === 0 &&
    runMile.hundred === 0 &&
    !p.three_w_bonus &&
    !p.five_w_bonus &&
    !p.mom_bonus &&
    !(p.runouts ?? 0) &&
    !(p.stumpings ?? 0) &&
    !p.captain;

  return (
    <tr className={isFantasyBench(p) ? "match-detail-tr--bench" : "match-detail-tr--xi"}>
      <td className="match-detail-td">
        <div className="match-detail-player-row">
          <span className="match-detail-player-name">{p.name}</span>
          {p.captain && <span className="match-detail-badge match-detail-badge--captain">★ Captain</span>}
          {isFantasyBench(p) && <span className="match-detail-badge match-detail-badge--bench">Super sub</span>}
        </div>
        <div className="match-detail-side-meta">
          <span className="match-detail-side-pill">{displaySide}</span>
        </div>
      </td>
      <td className="match-detail-td match-detail-td--muted">{p.runs}</td>
      <td className="match-detail-td match-detail-td--muted">{p.wickets}</td>
      <td className="match-detail-td match-detail-td--muted match-detail-td--tabular">{formatCtRoSt(p)}</td>
      <td className="match-detail-td match-detail-td--bonus">
        {p.catches > 0 && <div>Ct: +{p.catches * rules.catch}</div>}
        {!hasCenturyRunMilestone(p) && p.fifty_bonus > 0 && <div>50+: +{rules.fifty}</div>}
        {hasCenturyRunMilestone(p) && <div>100: +{rules.hundred}</div>}
        {p.three_w_bonus > 0 && <div>3W: +{rules.threeW}</div>}
        {p.five_w_bonus > 0 && <div>5W: +{rules.fiveW}</div>}
        {p.mom_bonus > 0 && <div>MOM: +{rules.mom}</div>}
        {(p.runouts ?? 0) > 0 && <div>RO: +{(p.runouts ?? 0) * rules.runout}</div>}
        {(p.stumpings ?? 0) > 0 && <div>ST: +{(p.stumpings ?? 0) * rules.stump}</div>}
        {p.captain && <div>Cap: ×2</div>}
        {noBonuses && <span className="match-detail-dash">—</span>}
      </td>
      <td className="match-detail-td match-detail-td--pts">
        {counted}
        {!pointsVoided && isFantasyBench(p) && pts.final > 0 && (
          <div className="match-detail-bench-note">(would be {pts.final} if in XI)</div>
        )}
      </td>
      <td className="match-detail-td">
        <ScoreEditor player={p} />
      </td>
    </tr>
  );
}

function TableHead() {
  return (
    <thead>
      <tr>
        {TABLE_HEAD.map((h) => (
          <th key={h} className="match-detail-th">
            {h}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export default async function MatchDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { c } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const matchId = parseInt(id, 10);
  if (isNaN(matchId)) {
    return (
      <main className="page-main match-detail match-detail--narrow">
        <NavBar title="Match Not Found" />
        <p>Invalid match ID.</p>
      </main>
    );
  }

  const { match, players, yourName, opponentName, compPlayers, isMulti, rules, competitionId: cid } = await getData(matchId, competitionId);

  const historyHref = cid != null ? `/history?c=${cid}` : "/history";
  const matchLiveHref =
    cid != null ? `/match?c=${encodeURIComponent(String(cid))}&m=${matchId}` : `/match?m=${matchId}`;

  if (!match) {
    return (
      <main className="page-main match-detail match-detail--narrow">
        <NavBar title="Match Not Found" />
        <p style={{ color: "var(--text-muted)" }}>No match found with ID {matchId}.</p>
        <Link href={historyHref} className="match-detail-link-back">
          ← Back to History
        </Link>
      </main>
    );
  }

  const yourPlayers = sortFantasyLineupForDisplay(
    cid == null ? players.filter((p) => p.side === "You") : players.filter((p) => p.side === yourName)
  );
  const oppPlayers = sortFantasyLineupForDisplay(
    cid == null ? players.filter((p) => p.side !== "You") : players.filter((p) => p.side === opponentName)
  );

  const matchRow = match as typeof match & {
    fantasy_voided?: boolean | null;
    lineup_lateness_enabled?: boolean | null;
    lineup_late_participant?: string | null;
    lineup_late_participants?: string[] | null;
    lineup_lateness_points?: number | null;
    lineup_lateness_by_comp?: unknown;
    external_match_id?: string | null;
  };
  const pointsVoided = isPointsVoidedMatchStatus(match.status, match.live_summary, matchRow.fantasy_voided);
  const manuallyVoided = matchRow.fantasy_voided === true;

  const lineupLatenessInput = matchLineupForCompetition(matchRow, cid);

  const yourRaw = pointsVoided ? 0 : yourPlayers.reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
  const oppRaw = pointsVoided ? 0 : oppPlayers.reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
  const allPart = isMulti ? compPlayers : [yourName, opponentName];
  const latenessOpts = { voided: pointsVoided, allParticipantNames: allPart };
  const yourTotal = yourRaw + lineupLatenessSideAdjustment(lineupLatenessInput, yourName, latenessOpts);
  const oppTotal = oppRaw + lineupLatenessSideAdjustment(lineupLatenessInput, opponentName, latenessOpts);

  const participantBlocks = isMulti
    ? compPlayers.map((name, i) => ({
        name,
        color: MULTI_COLORS[i % MULTI_COLORS.length],
        players: sortFantasyLineupForDisplay(players.filter((p) => p.side === name)),
        total:
          (pointsVoided
            ? 0
            : players.filter((p) => p.side === name).reduce((s, p) => s + fantasyPointsCounted(p, rules), 0)) +
          lineupLatenessSideAdjustment(lineupLatenessInput, name, latenessOpts),
      }))
    : null;

  const hasData = !pointsVoided && (isMulti
    ? (participantBlocks ?? []).some((b) => b.total !== 0)
    : yourTotal !== 0 || oppTotal !== 0 || yourRaw > 0 || oppRaw > 0);

  let winner: string | null = null;
  let diff = 0;
  if (hasData) {
    if (isMulti && participantBlocks) {
      const totals = participantBlocks.map((b) => b.total);
      const maxT = Math.max(...totals);
      const leaders = participantBlocks.filter((b) => b.total === maxT && maxT > 0);
      winner = leaders.length === 1 ? leaders[0]!.name : "Tie";
      const sorted = [...participantBlocks].sort((a, b) => b.total - a.total);
      diff = sorted.length >= 2 ? sorted[0]!.total - sorted[1]!.total : sorted[0]!.total;
    } else {
      winner = yourTotal > oppTotal ? yourName : oppTotal > yourTotal ? opponentName : "Tie";
      diff = Math.abs(yourTotal - oppTotal);
    }
  }

  const fixtureName = formatFixture(match.fixture) || match.fixture || "Match";
  const navSubtitle =
    cid != null && compPlayers.length > 0 ? `${compPlayers.join(" · ")} · ${match.match_date ?? ""}` : match.match_date ?? undefined;
  const { rosterNames, squads, nameToId } = parseRoster(match);

  const statusPillClass =
    match.status === "LIVE" ? "match-detail-status-pill match-detail-status-pill--live" : "match-detail-status-pill match-detail-status-pill--default";

  return (
    <main className="page-main match-detail">
      <NavBar title={fixtureName} subtitle={navSubtitle} />

      <div className="match-detail-back-wrap">
        <Link href={historyHref} className="match-detail-link-back">
          ← Match History
        </Link>
      </div>

      {pointsVoided ? (
        <div className="match-detail-alert-void" role="status">
          {manuallyVoided
            ? "Manually voided — fantasy points do not count toward standings or stats; player rows are stored as zero."
            : "Washout / no result — fantasy points for this match do not count. Sync scores to clear any stale stats in the database."}
        </div>
      ) : null}

      <div className="match-detail-stack">
        <div className="match-detail-hero">
          <div>
            <div className="match-detail-hero__meta">{match.match_date}</div>
            {match.last_synced_at ? (
              <p className="match-detail-hero__sync" title={formatUiDateTime(String(match.last_synced_at))}>
                Last synced {formatRelativeTimeAgo(String(match.last_synced_at))}
                <span className="match-detail-hero__sync-sep"> · </span>
                <span className="match-detail-hero__sync-abs">{formatUiDateTime(String(match.last_synced_at))}</span>
              </p>
            ) : (
              <p className="match-detail-hero__sync match-detail-hero__sync--muted">Not synced from the API yet</p>
            )}
            <div className="match-detail-hero__title">{fixtureName}</div>
            {match.venue && <div className="match-detail-hero__sub">{match.venue}</div>}
            {match.toss_winner && (
              <div className="match-detail-hero__sub match-detail-hero__sub--tight">Toss: {match.toss_winner}</div>
            )}
            <div className="match-detail-hero__actions">
              <SyncButton matchId={matchId} lastSyncedAt={match.last_synced_at ?? null} />
              <VoidMatchControl matchId={matchId} initialVoided={manuallyVoided} />
            </div>
            <LineupLatenessControl
              matchId={matchId}
              competitionId={cid}
              linked={Boolean(matchRow.external_match_id)}
              participantOptions={isMulti ? compPlayers : [yourName, opponentName]}
              initialEnabled={hasLineupLatenessActive(lineupLatenessInput, pointsVoided)}
              initialLateNames={lateParticipantsList(lineupLatenessInput)}
              initialPoints={
                typeof lineupLatenessInput.lineup_lateness_points === "number" &&
                lineupLatenessInput.lineup_lateness_points > 0
                  ? lineupLatenessInput.lineup_lateness_points
                  : DEFAULT_LINEUP_LATENESS_POINTS
              }
            />
            <div className="match-detail-hero__lineup">
              <MatchDetailLineupEditor
                yourName={yourName}
                opponentName={opponentName}
                yourPlayers={yourPlayers}
                opponentPlayers={oppPlayers}
                allPlayers={players}
                rosterNames={rosterNames}
                squads={squads}
                nameToId={nameToId}
                matchId={matchId}
                competitionId={cid}
                isMulti={isMulti}
                compPlayers={compPlayers}
              />
            </div>
          </div>
          <span className={statusPillClass}>{match.status ?? "—"}</span>
        </div>

        {isMulti && participantBlocks ? (
          <div className="match-detail-stats-grid">
            {participantBlocks.map((b) => (
              <div key={b.name} className="match-detail-stat-card">
                <div className="match-detail-stat-card__label">{b.name}</div>
                <div className="match-detail-stat-card__value" style={{ color: b.color }}>
                  {hasData ? b.total : "—"}
                </div>
                <div className="match-detail-stat-card__hint">{b.players.length} picks</div>
              </div>
            ))}
            <div className="match-detail-stat-card">
              <div className="match-detail-stat-card__label">Winner</div>
              <div
                className="match-detail-stat-card__value match-detail-stat-card__value--md"
                style={{
                  color: winner === "Tie" ? "#92400e" : MULTI_COLORS[compPlayers.indexOf(winner ?? "") % MULTI_COLORS.length] || "#0f172a",
                }}
              >
                {winner ?? "No data"}
              </div>
            </div>
            <div className="match-detail-stat-card">
              <div className="match-detail-stat-card__label">Top margin</div>
              <div className="match-detail-stat-card__value">{hasData ? `${diff} pts` : "—"}</div>
            </div>
          </div>
        ) : (
          <div className="match-detail-stats-grid">
            {[
              { label: `${yourName}'s Points`, value: hasData ? yourTotal : "—", color: "#2563eb" },
              { label: `${opponentName}'s Points`, value: hasData ? oppTotal : "—", color: "#dc2626" },
              {
                label: "Winner",
                value: winner ?? "No data",
                color: winner === yourName ? "#2563eb" : winner === opponentName ? "#dc2626" : "#92400e",
              },
              { label: "Points Diff", value: hasData ? `${diff} pts` : "—", color: "#0f172a" },
            ].map(({ label, value, color }) => (
              <div key={label} className="match-detail-stat-card">
                <div className="match-detail-stat-card__label">{label}</div>
                <div className="match-detail-stat-card__value" style={{ color }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        )}

        {!hasData ? (
          <div className="match-detail-empty">
            No player scores synced yet for this match.
            {match.is_current && (
              <>
                <br />
                <br />
                <Link href={matchLiveHref} className="match-detail-empty__link">
                  → Go to Live Match to sync scores
                </Link>
              </>
            )}
          </div>
        ) : isMulti && participantBlocks ? (
          <>
            {participantBlocks.map((b) => (
              <div key={b.name} className="match-detail-section" style={{ borderTop: `3px solid ${b.color}` }}>
                <h3 className="match-detail-section__title">{b.name}&apos;s team</h3>
                <div className="match-detail-section__meta">
                  Total: <strong style={{ color: b.color }}>{b.total} pts</strong> · {b.players.length} players
                </div>
                <div className="match-detail-section__scroll">
                  <table className="match-detail-table">
                    <TableHead />
                    <tbody>
                      {b.players.map((p) => (
                        <PlayerRow key={p.id} p={p} rules={rules} displaySide={b.name} pointsVoided={pointsVoided} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="match-detail-section">
              <h3 className="match-detail-section__title">{yourName}&apos;s Team</h3>
              <div className="match-detail-section__meta">
                Total: <strong style={{ color: "#2563eb" }}>{yourTotal} pts</strong>
              </div>
              <div className="match-detail-section__scroll">
                <table className="match-detail-table">
                  <TableHead />
                  <tbody>
                    {yourPlayers.map((p) => (
                      <PlayerRow key={p.id} p={p} rules={rules} displaySide={yourName} pointsVoided={pointsVoided} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="match-detail-section">
              <h3 className="match-detail-section__title">{opponentName}&apos;s Team</h3>
              <div className="match-detail-section__meta">
                Total: <strong style={{ color: "#dc2626" }}>{oppTotal} pts</strong>
              </div>
              <div className="match-detail-section__scroll">
                <table className="match-detail-table">
                  <TableHead />
                  <tbody>
                    {oppPlayers.map((p) => (
                      <PlayerRow key={p.id} p={p} rules={rules} displaySide={opponentName} pointsVoided={pointsVoided} />
                    ))}
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
