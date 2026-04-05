export const dynamic = "force-dynamic";
export const revalidate = 0;

import { resolveCompetitionId } from "@/lib/competition";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { FantasyPlayer, fantasyPointsCounted, formatCtRoSt, playerPoints, scoringFromSettings } from "@/lib/scoring";
import { formatFixture } from "@/lib/format";
import NavBar from "@/components/NavBar";
import SyncButton from "@/components/SyncButton";
import ScoreEditor from "@/components/ScoreEditor";
import MatchDetailLineupEditor from "@/components/MatchDetailLineupEditor";
import Link from "next/link";
import type { CSSProperties } from "react";

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
        ? [comp.player1_name, comp.player2_name].filter(Boolean) as string[]
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

function PlayerRow({ p, rules, displaySide }: { p: FantasyPlayer; rules: ReturnType<typeof scoringFromSettings>; displaySide: string }) {
  const pts = playerPoints(p, rules);
  const counted = fantasyPointsCounted(p, rules);
  return (
    <tr style={{ background: p.bench ? "#fafafa" : "white" }}>
      <td style={td}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600 }}>{p.name}</span>
          {p.captain && (
            <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6, background: "#fef9c3", color: "#92400e", fontWeight: 700 }}>★ Captain</span>
          )}
          {p.bench && (
            <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 6, background: "#e0e7ff", color: "#3730a3", fontWeight: 700 }}>Super sub</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
          <span
            style={{
              padding: "2px 6px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 600,
              background: "#f1f5f9",
              color: "#475569",
            }}
          >
            {displaySide}
          </span>
        </div>
      </td>
      <td style={{ ...td, color: "#475569" }}>{p.runs}</td>
      <td style={{ ...td, color: "#475569" }}>{p.wickets}</td>
      <td style={{ ...td, color: "#475569", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{formatCtRoSt(p)}</td>
      <td style={{ ...td, color: "#64748b", fontSize: 12 }}>
        {p.catches > 0 && <div>Ct: +{p.catches * rules.catch}</div>}
        {p.fifty_bonus > 0 && <div>50+: +{rules.fifty}</div>}
        {p.hundred_bonus > 0 && <div>100: +{rules.hundred}</div>}
        {p.three_w_bonus > 0 && <div>3W: +{rules.threeW}</div>}
        {p.five_w_bonus > 0 && <div>5W: +{rules.fiveW}</div>}
        {p.mom_bonus > 0 && <div>MOM: +{rules.mom}</div>}
        {(p.runouts ?? 0) > 0 && <div>RO: +{(p.runouts ?? 0) * rules.runout}</div>}
        {(p.stumpings ?? 0) > 0 && <div>ST: +{(p.stumpings ?? 0) * rules.stump}</div>}
        {p.captain && <div>Cap: ×2</div>}
        {!p.catches && !p.fifty_bonus && !p.hundred_bonus && !p.three_w_bonus && !p.five_w_bonus && !p.mom_bonus && !(p.runouts ?? 0) && !(p.stumpings ?? 0) && !p.captain && <span style={{ color: "#cbd5e1" }}>—</span>}
      </td>
      <td style={{ ...td, fontWeight: 800, fontSize: 18, color: "#0f172a" }}>
        {counted}
        {p.bench && pts.final > 0 && (
          <div style={{ fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>(would be {pts.final} if in XI)</div>
        )}
      </td>
      <td style={td}>
        <ScoreEditor player={p} />
      </td>
    </tr>
  );
}

export default async function MatchDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { c } = await searchParams;
  const competitionId = await resolveCompetitionId(c);
  const matchId = parseInt(id, 10);
  if (isNaN(matchId)) {
    return (
      <main className="page-main" style={{ maxWidth: 900 }}>
        <NavBar title="Match Not Found" />
        <p>Invalid match ID.</p>
      </main>
    );
  }

  const { match, players, yourName, opponentName, compPlayers, isMulti, rules, competitionId: cid } = await getData(matchId, competitionId);

  const historyHref = cid != null ? `/history?c=${cid}` : "/history";
  const matchLiveHref = cid != null ? `/match?c=${cid}` : "/match";

  if (!match) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <NavBar title="Match Not Found" />
        <p style={{ color: "#64748b" }}>No match found with ID {matchId}.</p>
        <Link href={historyHref} style={linkBack}>
          ← Back to History
        </Link>
      </main>
    );
  }

  const yourPlayers = cid == null ? players.filter((p) => p.side === "You") : players.filter((p) => p.side === yourName);
  const oppPlayers =
    cid == null
      ? players.filter((p) => p.side !== "You")
      : players.filter((p) => p.side === opponentName);
  const yourTotal = yourPlayers.reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);
  const oppTotal = oppPlayers.reduce((s, p) => s + fantasyPointsCounted(p, rules), 0);

  const participantBlocks = isMulti
    ? compPlayers.map((name, i) => ({
        name,
        color: MULTI_COLORS[i % MULTI_COLORS.length],
        players: players.filter((p) => p.side === name),
        total: players.filter((p) => p.side === name).reduce((s, p) => s + fantasyPointsCounted(p, rules), 0),
      }))
    : null;

  const hasData = isMulti
    ? (participantBlocks ?? []).some((b) => b.total > 0)
    : yourTotal > 0 || oppTotal > 0;

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

  return (
    <main className="page-main" style={{ maxWidth: 1000 }}>
      <NavBar title={fixtureName} subtitle={navSubtitle} />

      <div style={{ marginBottom: 16 }}>
        <Link href={historyHref} style={linkBack}>
          ← Match History
        </Link>
      </div>

      <div style={{ display: "grid", gap: 20 }}>
        <div
          style={{
            padding: "20px 24px",
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 13, color: "#64748b" }}>{match.match_date}</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4, color: "#0f172a" }}>{fixtureName}</div>
            {match.venue && <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{match.venue}</div>}
            {match.toss_winner && (
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Toss: {match.toss_winner}</div>
            )}
            <div style={{ marginTop: 14 }}>
              <SyncButton matchId={matchId} lastSyncedAt={match.last_synced_at ?? null} />
            </div>
            <div style={{ marginTop: 16 }}>
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
          <span
            style={{
              padding: "4px 12px",
              borderRadius: 999,
              background: match.status === "LIVE" ? "#dcfce7" : "#f1f5f9",
              color: match.status === "LIVE" ? "#16a34a" : "#64748b",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {match.status ?? "—"}
          </span>
        </div>

        {isMulti && participantBlocks ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
            {participantBlocks.map((b) => (
              <div key={b.name} style={{ padding: "14px 18px", background: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{b.name}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: b.color, marginTop: 4 }}>{hasData ? b.total : "—"}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>{b.players.length} picks</div>
              </div>
            ))}
            <div style={{ padding: "14px 18px", background: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Winner</div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: winner === "Tie" ? "#92400e" : MULTI_COLORS[compPlayers.indexOf(winner ?? "") % MULTI_COLORS.length] || "#0f172a",
                  marginTop: 4,
                }}
              >
                {winner ?? "No data"}
              </div>
            </div>
            <div style={{ padding: "14px 18px", background: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>Top margin</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{hasData ? `${diff} pts` : "—"}</div>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
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
              <div key={label} style={{ padding: "14px 18px", background: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {!hasData ? (
          <div style={{ textAlign: "center", padding: 40, background: "white", border: "1px solid #e2e8f0", borderRadius: 16, color: "#64748b" }}>
            No player scores synced yet for this match.
            {match.is_current && (
              <>
                <br />
                <br />
                <Link href={matchLiveHref} style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}>
                  → Go to Live Match to sync scores
                </Link>
              </>
            )}
          </div>
        ) : isMulti && participantBlocks ? (
          <>
            {participantBlocks.map((b) => (
              <div key={b.name} style={{ ...section, borderTop: `3px solid ${b.color}` }}>
                <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#0f172a" }}>{b.name}&apos;s team</h3>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
                  Total: <strong style={{ color: b.color }}>{b.total} pts</strong> · {b.players.length} players
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["Player", "Runs", "Wkts", "CT/RO/ST", "Bonuses", "Points", ""].map((h) => (
                          <th key={h} style={th}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.players.map((p) => (
                        <PlayerRow key={p.id} p={p} rules={rules} displaySide={b.name} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={section}>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#0f172a" }}>{yourName}&apos;s Team</h3>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
                Total: <strong style={{ color: "#2563eb" }}>{yourTotal} pts</strong>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Player", "Runs", "Wkts", "CT/RO/ST", "Bonuses", "Points", ""].map((h) => (
                        <th key={h} style={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {yourPlayers.map((p) => (
                      <PlayerRow key={p.id} p={p} rules={rules} displaySide={yourName} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={section}>
              <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#0f172a" }}>{opponentName}&apos;s Team</h3>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 14 }}>
                Total: <strong style={{ color: "#dc2626" }}>{oppTotal} pts</strong>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Player", "Runs", "Wkts", "CT/RO/ST", "Bonuses", "Points", ""].map((h) => (
                        <th key={h} style={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {oppPlayers.map((p) => (
                      <PlayerRow key={p.id} p={p} rules={rules} displaySide={opponentName} />
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

const section: CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 20, padding: 20 };
const th: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  borderBottom: "2px solid #e2e8f0",
  color: "#475569",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const td: CSSProperties = { padding: "12px 12px", borderBottom: "1px solid #f1f5f9", fontSize: 14, verticalAlign: "top" };
const linkBack: CSSProperties = { color: "#2563eb", textDecoration: "none", fontWeight: 500 };
