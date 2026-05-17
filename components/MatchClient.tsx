"use client";

import React, { useState, useEffect, useCallback, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatFixture } from "@/lib/format";
import { formatUiCalendarDate, formatUiDateTime } from "@/lib/ui-time";
import PlayerTable from "@/components/PlayerTable";
import ManualScorePanel from "@/components/ManualScorePanel";
import SelectClient from "@/components/SelectClient";
import { FantasyPlayer, teamPoints } from "@/lib/scoring";
import type { MatchLineupLateness } from "@/lib/lineup-lateness";
import { lineupLatenessSideAdjustment } from "@/lib/lineup-lateness";
import ApiMessage from "@/components/ApiMessage";
import { classifyApiMsg, type ApiMsg } from "@/lib/api-message";
import { navigateToMatchAfterSeed } from "@/lib/post-seed-nav-client";
import { recordSyncDebugClient } from "@/lib/sync-debug-storage";
import {
  type MatchChoice,
  emptyFixtureListCopy,
  fetchMatchesToday,
  fixturePickerBannerCopy,
  parseMatchesTodayResponse,
  shouldDebitFixtureListCredits,
} from "@/lib/fixture-list-client";
import {
  combinedHitsFromKeyStats,
  combinedQuotaCap,
  FALLBACK_QUOTA_CAP,
  type KeyStatsApiResponse,
} from "@/lib/combined-quota";
import { isWithinRefreshCooldown, minutesUntilRefreshAllowed } from "@/lib/refresh-cooldown";

const QUOTA_KEY = "cricapi_quota";

function loadQuota(): number {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return 0;
    const { count, date } = JSON.parse(raw) as { count: number; date: string };
    return date === formatUiCalendarDate() ? (count ?? 0) : 0;
  } catch { return 0; }
}
function saveQuota(count: number) {
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify({ count, date: formatUiCalendarDate() })); } catch {}
}

type CurrentMatch = { fixture?: string; label?: string; status?: string; venue?: string | null; toss_winner?: string | null; live_summary?: string | null; last_synced_at?: string | null };

type SquadTeam = { teamName: string; players: string[] };

type Props = {
  yourName: string;
  opponentName: string;
  yourFantasyPlayers: FantasyPlayer[];
  opponentFantasyPlayers: FantasyPlayer[];
  /** DB row id for the linked fixture — sent with sync/refresh so the correct match updates */
  matchId?: number | null;
  currentMatch: CurrentMatch | null;
  hasLinkedMatch: boolean;
  yourLineupSaved: boolean;
  opponentLineupSaved: boolean;
  // Squad/roster props for inline team selection
  rosterNames: string[];
  squads: SquadTeam[];
  nameToId: Record<string, string>;
  existingYourPlayers: { name: string; captain: boolean; bench?: boolean | null; provider_player_id?: string | null }[];
  existingOppPlayers: { name: string; captain: boolean; bench?: boolean | null; provider_player_id?: string | null }[];
  competitionId?: number | null;
  /** For 3+ player competitions — all participants and their picks */
  allParticipants?: { name: string; players: FantasyPlayer[] }[];
  pointsVoided?: boolean;
  lineupLatenessMeta?: MatchLineupLateness | null;
  /** True when on-time bonus rule applies (show scores even if no lineups). */
  lineupLatenessActive?: boolean;
  /** CricketData mode + linked CricAPI id — show Cricbuzz scorecard sync. */
  cricbuzzScoreSyncEnabled?: boolean;
  /** Per-name pick counts for this competition — roster picker sorts by frequency first. */
  rosterPickCounts?: Record<string, number> | null;
};

export default function MatchClient({
  yourName,
  opponentName,
  yourFantasyPlayers,
  opponentFantasyPlayers,
  matchId,
  currentMatch,
  hasLinkedMatch,
  yourLineupSaved,
  opponentLineupSaved,
  rosterNames,
  squads,
  nameToId,
  existingYourPlayers,
  existingOppPlayers,
  competitionId,
  allParticipants,
  pointsVoided = false,
  lineupLatenessMeta = null,
  lineupLatenessActive = false,
  cricbuzzScoreSyncEnabled = false,
  rosterPickCounts = null,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** Prefer `?m=` from the URL when set so Sync matches the tab/chip the user opened (same as server RSC after navigation). */
  const queryM = searchParams.get("m")?.trim() ?? "";
  const urlMatchId = /^\d+$/.test(queryM) ? parseInt(queryM, 10) : null;
  const syncMatchId =
    urlMatchId != null && urlMatchId > 0 ? urlMatchId : matchId != null && matchId > 0 ? matchId : null;

  const isMultiPlayer = (allParticipants?.length ?? 0) > 2;
  // Inline picker while no lineups exist; after the first save, show match view (pending banner for others).
  const hasAnyLineup = isMultiPlayer
    ? (allParticipants ?? []).some((p) => p.players.length > 0)
    : yourLineupSaved || opponentLineupSaved;
  const needsSetup = !hasAnyLineup && hasLinkedMatch && !lineupLatenessActive;
  const [teamPickerOpen, setTeamPickerOpen] = useState(needsSetup);
  const changeTeamsPickerOpenedRef = React.useRef(false);

  const openTeamPickerManually = useCallback(() => {
    changeTeamsPickerOpenedRef.current = true;
    setTeamPickerOpen(true);
  }, []);

  useEffect(() => {
    if (changeTeamsPickerOpenedRef.current) return;
    setTeamPickerOpen(needsSetup);
  }, [needsSetup]);

  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [apiMsg, setApiMsg] = useState<ApiMsg | null>(() => {
    // Restore any message that was saved before a page reload
    try {
      const saved = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("match_msg") : null;
      if (saved) { sessionStorage.removeItem("match_msg"); return JSON.parse(saved) as ApiMsg; }
    } catch {}
    return null;
  });
  const [apiUsed, setApiUsed] = useState(0);
  const [quotaCap, setQuotaCap] = useState(FALLBACK_QUOTA_CAP);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number } | null>(null);
  const [showRefreshCooldownPrompt, setShowRefreshCooldownPrompt] = useState(false);

  const refreshKeyStatsBundle = useCallback(() => {
    fetch("/api/key-stats")
      .then((r) => r.json())
      .then((j: KeyStatsApiResponse) => {
        if (!j.ok) return;
        setQuotaCap(combinedQuotaCap(j));
        const th = combinedHitsFromKeyStats(j);
        if (th != null) {
          setApiUsed(th);
          saveQuota(th);
        }
      })
      .catch(() => {});
  }, []);
  const [linkChoices, setLinkChoices] = useState<MatchChoice[] | null>(null);
  const [pickedLinkId, setPickedLinkId] = useState("");
  const [linkDateHint, setLinkDateHint] = useState("");
  /** Picker list came from DB cache vs live API (`/api/matches/today`). */
  const [fixtureListSource, setFixtureListSource] = useState<"cache" | "api" | null>(null);

  useEffect(() => {
    setApiUsed(loadQuota());
    refreshKeyStatsBundle();
  }, [refreshKeyStatsBundle]);

  useEffect(() => {
    if (lineupLatenessActive) setTeamPickerOpen(false);
  }, [lineupLatenessActive]);

  const addUsage = useCallback((n: number) => {
    setApiUsed((prev) => { const next = prev + n; saveQuota(next); return next; });
  }, []);

  const warnAt = Math.floor(quotaCap * 0.8);
  const remaining = quotaCap - apiUsed;
  /** Over cap: handled separately so sync can still run the same path as History (cooldown → server). */
  const isNearLimit = apiUsed >= warnAt && remaining > 0;
  const isAtLimit = remaining <= 0;

  const allPartNames = isMultiPlayer
    ? (allParticipants ?? []).map((p) => p.name)
    : [yourName, opponentName];
  const latenessOpts = { voided: pointsVoided, allParticipantNames: allPartNames };
  const withLateness = (name: string, raw: number) =>
    raw + (lineupLatenessMeta ? lineupLatenessSideAdjustment(lineupLatenessMeta, name, latenessOpts) : 0);

  const yourTotal = withLateness(yourName, teamPoints(yourFantasyPlayers));
  const oppTotal = withLateness(opponentName, teamPoints(opponentFantasyPlayers));
  const leader = yourTotal === oppTotal ? "Tied" : yourTotal > oppTotal ? `You +${yourTotal - oppTotal}` : `${opponentName} +${oppTotal - yourTotal}`;

  /** Per-participant totals for 3+ player comps — do not use opponentFantasyPlayers (that merges everyone except player 1). */
  const multiScoreboard =
    isMultiPlayer && allParticipants && allParticipants.length > 0
      ? allParticipants
          .map((p) => ({
            name: p.name,
            players: p.players,
            total: withLateness(p.name, teamPoints(p.players)),
          }))
          .sort((a, b) => b.total - a.total)
      : null;

  type ScoreCardRow = { label: string; value: string | number; sub?: string; color: string };
  let scoreCardRows: ScoreCardRow[];
  if (multiScoreboard && multiScoreboard.length > 0) {
    let leaderStr = "—";
    if (multiScoreboard.length >= 2) {
      const first = multiScoreboard[0]!;
      const second = multiScoreboard[1]!;
      leaderStr =
        first.total === second.total ? "Tied" : `${first.name} +${first.total - second.total}`;
    } else if (multiScoreboard[0]!.total > 0) {
      leaderStr = `${multiScoreboard[0]!.name} leads`;
    }
    scoreCardRows = [
      ...multiScoreboard.map((r, idx) => ({
        label: r.name,
        value: r.total,
        sub: "pts",
        color: idx === 0 && r.total > 0 ? "#1d4ed8" : "#0f172a",
      })),
      { label: "Leader", value: leaderStr, color: "#0f172a" },
    ];
  } else {
    scoreCardRows = [
      { label: `${yourName}`, value: yourTotal, sub: "pts", color: "#1d4ed8" },
      { label: `${opponentName}`, value: oppTotal, sub: "pts", color: "#dc2626" },
      { label: "Leader", value: leader, color: "#0f172a" },
    ];
  }

  const showMsg = useCallback((text: string, context?: string) => {
    setApiMsg(classifyApiMsg(text, context));
    setMessage("");
  }, []);

  function guardedRun(cost: number, fn: () => Promise<void>) {
    if (isAtLimit) {
      // Sync (1) and cached fixture list (0) still run; API refresh (2) is blocked at quota.
      if (cost < 2) {
        void fn();
        return;
      }
      setApiMsg(classifyApiMsg("Daily API quota exhausted", "Quota"));
      return;
    }
    if (isNearLimit && cost > 0) {
      setPendingAction({ fn, cost });
      return;
    }
    void fn();
  }

  /** User clicked Sync — may open in-app cooldown gate instead of calling the API immediately. */
  async function beginUserSyncScores() {
    if (isWithinRefreshCooldown(currentMatch?.last_synced_at)) {
      setShowRefreshCooldownPrompt(true);
      return;
    }
    await doRefreshNow();
  }

  async function doRefreshNow(opts?: { force?: boolean; cricbuzzFallback?: boolean; cricbuzzOnly?: boolean }) {
    const cricbuzzOnly = opts?.cricbuzzOnly === true;
    const force = opts?.force === true || (!!opts?.cricbuzzFallback && !cricbuzzOnly);
    const cricbuzzFallback = opts?.cricbuzzFallback === true && !cricbuzzOnly;
    setShowRefreshCooldownPrompt(false);
    setSyncing(true);
    setApiMsg({
      type: "loading",
      title: cricbuzzOnly ? "Loading Cricbuzz scorecard…" : "Syncing scores…",
    });
    try {
      if (syncMatchId == null) {
        setSyncing(false);
        setApiMsg({
          type: "error",
          title: "Cannot sync — no match id",
          detail: "Reload the page or open this match from History / Match tabs.",
        });
        return;
      }

      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: syncMatchId, force, cricbuzzFallback, cricbuzzOnly }),
      });
      const json = await res.json();
      setSyncing(false);
      recordSyncDebugClient(syncMatchId, json as Record<string, unknown>, "match-detail");

      if (!json.ok) {
        const errorText = json.error || "Refresh failed";
        if (res.status === 409 && json.code === "RECENT_SYNC") {
          setApiMsg({
            type: "info",
            title: "Sync skipped",
            detail: errorText,
          });
          return;
        }
        const classified = classifyApiMsg(errorText, cricbuzzOnly ? "Cricbuzz sync" : "Sync scores");
        setApiMsg(classified);
        if (!cricbuzzOnly && (classified.type === "warning" || classified.type === "error")) {
          const blocked = /rate.?limit|block|quota|exhausted/i.test(errorText);
          if (blocked && (yourFantasyPlayers.length > 0 || opponentFantasyPlayers.length > 0)) {
            setShowManual(true);
          }
        }
        return;
      }

      if (!cricbuzzOnly) {
        addUsage(1);
        refreshKeyStatsBundle();
      }
      const successMsg: ApiMsg = { type: "success", title: json.message || "Scores updated!" };
      setApiMsg(successMsg);
      router.refresh();
    } catch (e) {
      setSyncing(false);
      setApiMsg(classifyApiMsg(e instanceof Error ? e.message : "Network error during sync.", "Sync scores"));
    }
  }

  async function doSubmitSeedLink(externalMatchId: string) {
    if (!externalMatchId) { showMsg("Pick a match first.", "Link"); return; }
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Linking match…" });
    try {
      const res = await fetch("/api/seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalMatchId }) });
      const json = await res.json();
      setLinkChoices(null);
      setFixtureListSource(null);
      addUsage(1);
      refreshKeyStatsBundle();
      showMsg(json.ok ? "Match linked! Opening…" : (json.error || "Could not link match."), "Link match");
      if (json.ok) {
        const mid = json.match && typeof json.match.id === "number" ? json.match.id : null;
        if (mid != null) navigateToMatchAfterSeed(mid);
        else window.location.reload();
      }
    } catch { showMsg("Network error while linking.", "Link match"); }
    setSyncing(false);
  }

  async function loadFixtureChoicesFromServer(refresh: boolean) {
    const json = await fetchMatchesToday(refresh, { debugLabel: "match-matches-today" });
    if (shouldDebitFixtureListCredits(json.source)) addUsage(2);
    refreshKeyStatsBundle();
    const parsed = parseMatchesTodayResponse(json);
    if (parsed.kind === "error") {
      showMsg(parsed.message, "Load fixtures");
      return false;
    }
    if (parsed.kind === "empty") {
      const { title, detail } = emptyFixtureListCopy(parsed.totalRaw);
      setApiMsg({ type: "info", title, detail });
      return false;
    }
    if (parsed.kind === "auto_link") {
      await doSubmitSeedLink(parsed.externalMatchId);
      return true;
    }
    setFixtureListSource(parsed.source);
    setLinkDateHint(parsed.date);
    setLinkChoices(parsed.choices);
    setPickedLinkId(parsed.choices[0]?.externalMatchId || "");
    const { title, detail } = fixturePickerBannerCopy(parsed.choices.length, parsed.source);
    setApiMsg({ type: "info", title, detail });
    return true;
  }

  async function doStartLinkMatch() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Loading IPL fixtures…" });
    setLinkChoices(null);
    setFixtureListSource(null);
    try {
      await loadFixtureChoicesFromServer(false);
    } catch {
      showMsg("Network error loading matches.", "Load fixtures");
    }
    setSyncing(false);
  }

  async function doRefreshFixtureListFromApi() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Fetching latest fixtures from API…" });
    try {
      await loadFixtureChoicesFromServer(true);
    } catch {
      showMsg("Network error loading matches.", "Load fixtures");
    }
    setSyncing(false);
  }

  const fixtureName = formatFixture(currentMatch?.fixture) || currentMatch?.fixture || "No match linked";
  const lastSynced = currentMatch?.last_synced_at
    ? formatUiDateTime(currentMatch.last_synced_at)
    : "Not yet";

  // ── Inline team picker (no lineup yet, or "Change Team" requested) ─────────
  if (teamPickerOpen) {
    return (
      <div className="select-embed-shell select-studio-root">
        <div className="select-surface-card">
          <div className="select-control-bar__row select-control-bar__row--spread">
            <div>
              <div className="select-roster-panel__title" style={{ marginBottom: 2 }}>
                {needsSetup ? "Set up your teams" : "Change teams"}
              </div>
              <div className="select-roster-panel__sub" style={{ marginTop: 0 }}>
                {fixtureName !== "No match linked" ? fixtureName : "Link a match first"}
              </div>
            </div>
            {!needsSetup && (
              <button
                type="button"
                className="select-btn-secondary-sm"
                onClick={() => {
                  changeTeamsPickerOpenedRef.current = false;
                  setTeamPickerOpen(false);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>
        <SelectClient
          yourName={yourName}
          opponentName={opponentName}
          yourPlayers={existingYourPlayers}
          opponentPlayers={existingOppPlayers}
          rosterNames={rosterNames}
          squads={squads}
          nameToId={nameToId}
          hasLinkedMatch={hasLinkedMatch}
          matchId={syncMatchId ?? null}
          competitionId={competitionId ?? null}
          compPlayers={isMultiPlayer ? (allParticipants ?? []).map(p => p.name) : undefined}
          existingPicks={isMultiPlayer ? (allParticipants ?? []).map(p => p.players.map(fp => ({
            name: fp.name,
            captain: fp.captain,
            bench: fp.bench,
            provider_player_id: fp.provider_player_id ?? null,
          }))) : undefined}
          pickCounts={rosterPickCounts}
        />
      </div>
    );
  }

  if (!hasLinkedMatch) {
    return (
      <div style={{ textAlign: "center", padding: 60, border: "1px solid #e2e8f0", borderRadius: 20, background: "white" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏏</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No match linked yet</div>
        <div style={{ color: "#64748b", marginBottom: 20 }}>Use the "Link IPL Match" button below to get started.</div>
        <button onClick={openTeamPickerManually} style={{ ...btnPrimary, border: "none", cursor: "pointer" }}>
          Set up teams →
        </button>
      </div>
    );
  }

  // Work out who still needs to pick (for the pending notice)
  const pendingPickers: string[] = isMultiPlayer
    ? (allParticipants ?? []).filter(p => p.players.length === 0).map(p => p.name)
    : [
        ...(!yourLineupSaved ? [yourName] : []),
        ...(!opponentLineupSaved ? [opponentName] : []),
      ];

  return (
    <div style={{ display: "grid", gap: 20 }}>

      {/* Pending lineups banner */}
      {pendingPickers.length > 0 && !lineupLatenessActive && (
        <div style={{ padding: "12px 16px", borderRadius: 14, background: "#fffbeb", border: "1px solid #fde68a", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 14, color: "#92400e" }}>
            ⏳ <strong>{pendingPickers.join(", ")}</strong> {pendingPickers.length === 1 ? "hasn't" : "haven't"} picked {pendingPickers.length === 1 ? "their" : "their"} team yet — scores will show as 0.
          </div>
          <button
            type="button"
            onClick={openTeamPickerManually}
            style={{
              padding: "8px 16px",
              borderRadius: 12,
              background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
              color: "white",
              border: "none",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 12px rgba(37,99,235,0.3)",
            }}
          >
            Pick teams →
          </button>
        </div>
      )}

      {pendingPickers.length > 0 && lineupLatenessActive && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 14,
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            fontSize: 14,
            color: "#166534",
          }}
        >
          On-time lineup bonus is on: totals show fantasy points plus the bonus for anyone who was not late. You can still{" "}
          <button
            type="button"
            onClick={openTeamPickerManually}
            style={{ padding: 0, border: "none", background: "none", color: "#15803d", fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}
          >
            add lineups
          </button>{" "}
          if needed.
        </div>
      )}

      {/* Match header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, padding: "18px 20px", background: "white", border: "1px solid #e2e8f0", borderRadius: 20 }}>
        <div>
          <div style={{ fontSize: 13, color: "#64748b" }}>Current Match</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{fixtureName}</div>
          {currentMatch?.venue && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{currentMatch.venue}</div>}
          {currentMatch?.live_summary && <div style={{ fontSize: 14, color: "#475569", marginTop: 4 }}>{currentMatch.live_summary}</div>}
          {currentMatch?.toss_winner && <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Toss: {currentMatch.toss_winner}</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <span style={{ padding: "4px 12px", borderRadius: 999, background: currentMatch?.status === "LIVE" ? "#dcfce7" : "#f1f5f9", color: currentMatch?.status === "LIVE" ? "#16a34a" : "#64748b", fontSize: 13, fontWeight: 600 }}>
            {currentMatch?.status ?? "—"}
          </span>
          <button
            onClick={openTeamPickerManually}
            style={{ padding: "6px 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", color: "#475569", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >
            ✏️ Change teams
          </button>
        </div>
      </div>

      {/* Score cards — multi-player: one card per person + Leader (not merged "opponent" bucket) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 140px), 1fr))",
          gap: 12,
        }}
      >
        {scoreCardRows.map(({ label, value, sub, color }) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: 14, background: "white", padding: "12px 14px" }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
            <div style={{ fontSize: "clamp(1.1rem, 4vw, 1.6rem)", fontWeight: 800, color }}>{value}</div>
            {sub && <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* Sync bar */}
      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "12px 14px" }}>
          <button onClick={() => guardedRun(1, beginUserSyncScores)} disabled={syncing} style={{ ...btnPrimary, flex: "1 1 auto", textAlign: "center" as const }}>
            {syncing ? "Syncing…" : "⟳ Sync Scores"}
          </button>
          {cricbuzzScoreSyncEnabled && hasLinkedMatch && syncMatchId != null && !pointsVoided ? (
            <button
              type="button"
              onClick={() => guardedRun(0, () => doRefreshNow({ cricbuzzOnly: true }))}
              disabled={syncing}
              title="Public Cricbuzz scorecard only — does not use CricketData or your API quota"
              style={{ ...btnSecondary, flex: "1 1 auto", textAlign: "center" as const, fontWeight: 600 }}
            >
              {syncing ? "Syncing…" : "Sync from Cricbuzz"}
            </button>
          ) : null}
          <button onClick={() => guardedRun(0, doStartLinkMatch)} disabled={syncing} style={{ ...btnSecondary, flex: "1 1 auto", textAlign: "center" as const }}>
            {syncing ? "Loading…" : "Link Match"}
          </button>
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", padding: "0 2px" }}>
            <span>Last synced: {lastSynced}</span>
            <span style={{ color: isAtLimit ? "#b91c1c" : "#94a3b8" }}>{apiUsed}/{quotaCap} credits (all keys)</span>
          </div>
        </div>
        {/* Message sits in its own full-width row below the buttons */}
        {(apiMsg || message) && !linkChoices && (
          <div style={{ padding: "0 12px 12px" }}>
            {apiMsg
              ? <ApiMessage msg={apiMsg} onDismiss={() => setApiMsg(null)} />
              : <ApiMessage msg={classifyApiMsg(message)} onDismiss={() => setMessage("")} />
            }
          </div>
        )}
        {cricbuzzScoreSyncEnabled && hasLinkedMatch && syncMatchId != null && !pointsVoided ? (
          <div style={{ padding: "0 14px 12px", fontSize: 12, color: "#94a3b8", lineHeight: 1.45 }}>
            <strong style={{ color: "#64748b" }}>Sync from Cricbuzz</strong> loads the public scorecard only — it does not call CricketData or count toward API credits.
          </div>
        ) : null}
      </div>

      {/* Quota warning */}
      {pendingAction && (
        <div style={{ border: "2px solid #fcd34d", borderRadius: 14, background: "#fffbeb", padding: 14 }}>
          <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚠️ Low on credits ({remaining} left)</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnPrimary} onClick={() => { const a = pendingAction; setPendingAction(null); void a.fn(); }}>Yes, use {pendingAction.cost}</button>
            <button style={btnSecondary} onClick={() => setPendingAction(null)}>Cancel</button>
          </div>
        </div>
      )}

      {showRefreshCooldownPrompt && (
        <div style={{ border: "2px solid #bfdbfe", borderRadius: 14, background: "#f0f9ff", padding: 14 }}>
          <div style={{ fontWeight: 700, color: "#1e40af", marginBottom: 8 }}>Recent sync</div>
          <div style={{ fontSize: 14, color: "#1e3a8a", marginBottom: 12 }}>
            Last refresh was less than 15 minutes ago. API keys are limited — sync again only if you really need the latest scores.
            {(() => {
              const m = minutesUntilRefreshAllowed(currentMatch?.last_synced_at);
              return m != null ? ` You can sync without this prompt in about ${m} minute${m === 1 ? "" : "s"}.` : "";
            })()}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btnPrimary}
              onClick={() => {
                setShowRefreshCooldownPrompt(false);
                void doRefreshNow({ force: true });
              }}
            >
              Yes, refresh anyway
            </button>
            <button
              type="button"
              style={btnSecondary}
              onClick={() => {
                setShowRefreshCooldownPrompt(false);
                setApiMsg({
                  type: "info",
                  title: "Sync skipped",
                  detail: 'Scores were already synced recently. Use "Yes, refresh anyway" when you need updated stats.',
                });
              }}
            >
              No, keep current data
            </button>
          </div>
        </div>
      )}

      {/* Match picker */}
      {linkChoices && linkChoices.length > 1 && (
        <div style={{ border: "1px solid #bfdbfe", borderRadius: 16, background: "#f0f9ff", padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose an IPL match to import</div>
          {linkDateHint && <div style={{ color: "#64748b", fontSize: 13, marginBottom: 10 }}>Showing ±1 day (Eastern) · {linkDateHint}</div>}
          {fixtureListSource === "cache" && (
            <div style={{ fontSize: 12, color: "#0369a1", marginBottom: 10, padding: "8px 10px", background: "#e0f2fe", borderRadius: 8 }}>
              Using saved fixture list — no API call. Use the button below if a match is missing.
            </div>
          )}
          <div style={{ display: "grid", gap: 8 }}>
            {linkChoices.map((c) => (
              <label key={c.externalMatchId || c.fixture} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 11, borderRadius: 10, border: pickedLinkId === c.externalMatchId ? "2px solid #2563eb" : "1px solid #e2e8f0", background: pickedLinkId === c.externalMatchId ? "#eff6ff" : "white", cursor: "pointer" }}>
                <input type="radio" name="lpm" checked={pickedLinkId === c.externalMatchId} onChange={() => setPickedLinkId(c.externalMatchId || "")} style={{ marginTop: 3 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{formatFixture(c.fixture) || c.fixture}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{c.status}{c.venue ? ` · ${c.venue}` : ""}{c.match_date ? ` · ${c.match_date}` : ""}</div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button style={btnPrimary} onClick={() => void doSubmitSeedLink(pickedLinkId)} disabled={syncing || !pickedLinkId}>{syncing ? "Working…" : "Link selected"}</button>
            <button style={btnSecondary} onClick={() => { setLinkChoices(null); setMessage(""); setFixtureListSource(null); }}>Cancel</button>
          </div>
          {fixtureListSource === "cache" && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #bae6fd" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Fixture not listed? Pull the latest IPL list from CricAPI (uses ~2 API credits).</div>
              <button type="button" style={btnSecondary} onClick={() => guardedRun(2, doRefreshFixtureListFromApi)} disabled={syncing}>
                {syncing ? "Loading…" : "Refresh list from API"}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Multi-player scoreboard */}
      {isMultiPlayer && multiScoreboard && multiScoreboard.some((p) => p.players.length > 0) && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>Participant Scores</div>
          {multiScoreboard.map((p, i) => (
            <div key={p.name} style={{ padding: "12px 16px", border: "1px solid #e2e8f0", borderRadius: 14, background: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", width: 20 }}>#{i + 1}</span>
                <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                {p.players.length === 0 && <span style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>no lineup</span>}
              </div>
              <span style={{ fontSize: 22, fontWeight: 800, color: i === 0 && p.total > 0 ? "#2563eb" : "#0f172a" }}>{p.total} <span style={{ fontSize: 12, color: "#94a3b8" }}>pts</span></span>
            </div>
          ))}
        </div>
      )}

      {/* Player tables — all participants for multi-player, or 2 for head-to-head */}
      {(() => {
        // Build the list of participant groups to display
        const groups: { title: string; players: FantasyPlayer[] }[] = isMultiPlayer && allParticipants && allParticipants.length > 0
          ? allParticipants
              .map(p => ({ title: p.name, players: p.players }))
              .sort((a, b) => teamPoints(b.players) - teamPoints(a.players))
          : [
              { title: `${yourName}'s Team`, players: yourFantasyPlayers },
              { title: `${opponentName}'s Team`, players: opponentFantasyPlayers },
            ];

        const hasAnyPlayers = groups.some(g => g.players.length > 0);
        const allPlayers = groups.flatMap(g => g.players);

        if (!hasAnyPlayers) {
          return (
            <div style={{ textAlign: "center", padding: 32, border: "1px solid #e2e8f0", borderRadius: 16, background: "white", color: "#64748b" }}>
              {hasAnyLineup
                ? <>Lineups saved — click <strong>Sync Scores</strong> to load runs and wickets.</>
                : <>No lineups yet. Save teams first, then click <strong>Sync Scores</strong>.</>}
            </div>
          );
        }

        return (
          <>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowManual((v) => !v)}
                style={{
                  padding: "6px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  border: showManual ? "1px solid #d97706" : "1px solid #e2e8f0",
                  background: showManual ? "#fef9c3" : "white",
                  color: showManual ? "#92400e" : "#64748b",
                }}
              >
                {showManual ? "✕ Close editor" : "✏️ Edit scores manually"}
              </button>
            </div>

            {showManual ? (
              <ManualScorePanel
                yourName={yourName}
                opponentName={opponentName}
                players={allPlayers}
              />
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {groups.map(g => g.players.length > 0 && (
                  <PlayerTable key={g.title} title={g.title} players={g.players} />
                ))}
              </div>
            )}
          </>
        );
      })()}

    </div>
  );
}

const btnPrimary: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  boxShadow: "0 2px 14px rgba(37,99,235,0.32)",
};
const btnSecondary: CSSProperties = {
  padding: "10px 18px",
  borderRadius: 14,
  border: "1px solid var(--border-strong)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  boxShadow: "var(--shadow-xs)",
};
