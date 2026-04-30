"use client";

import React, { useEffect, useMemo, useState, useCallback, type CSSProperties } from "react";
import { formatFixture } from "@/lib/format";
import { formatUiCalendarDate, formatUiDateTime } from "@/lib/ui-time";
import { recordSyncDebugClient } from "@/lib/sync-debug-storage";
import ScoreCard from "@/components/ScoreCard";
import PlayerTable from "@/components/PlayerTable";
import { FantasyPlayer, teamPoints } from "@/lib/scoring";
import { navigateToMatchAfterSeed } from "@/lib/post-seed-nav-client";
import {
  anyKeyBlocked,
  combinedHitsFromKeyStats,
  combinedQuotaCap,
  FALLBACK_QUOTA_CAP,
  type KeyStatsApiResponse,
} from "@/lib/combined-quota";
import { isWithinRefreshCooldown, minutesUntilRefreshAllowed } from "@/lib/refresh-cooldown";
import {
  type MatchChoice,
  emptyFixtureListPlainMessage,
  fetchMatchesToday,
  fixturePickerPlainMessage,
  parseMatchesTodayResponse,
  shouldDebitFixtureListCredits,
} from "@/lib/fixture-list-client";

const QUOTA_KEY = "cricapi_quota";

function loadQuota(): number {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return 0;
    const { count, date } = JSON.parse(raw) as { count: number; date: string };
    return date === formatUiCalendarDate() ? (count ?? 0) : 0;
  } catch {
    return 0;
  }
}

function saveQuota(count: number) {
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ count, date: formatUiCalendarDate() }));
  } catch {}
}

type Player = {
  name: string;
  captain: boolean;
};

type SquadTeam = {
  teamName: string;
  players: string[];
};

type CurrentMatch = {
  fixture?: string;
  label?: string;
  status?: string;
  venue?: string | null;
  toss_winner?: string | null;
  live_summary?: string | null;
  last_synced_at?: string | null;
};

type Props = {
  opponentName: string;
  yourPlayers: Player[];
  opponentPlayers: Player[];
  yourFantasyPlayers: FantasyPlayer[];
  opponentFantasyPlayers: FantasyPlayer[];
  rosterNames: string[];
  squads: SquadTeam[];
  hasLinkedMatch: boolean;
  currentMatch: CurrentMatch | null;
};

function emptyPlayers() {
  return Array.from({ length: 4 }, () => ({ name: "", captain: false }));
}

function withFallback(players: Player[]) {
  const next = emptyPlayers();
  for (let i = 0; i < Math.min(players.length, 4); i += 1) {
    next[i] = players[i];
  }
  if (!next.some((p) => p.captain) && next[0]) {
    next[0].captain = true;
  }
  return next;
}

function QuotaBar({
  apiUsed,
  quotaCap,
  isNearLimit,
  isAtLimit,
  remaining,
}: {
  apiUsed: number;
  quotaCap: number;
  isNearLimit: boolean;
  isAtLimit: boolean;
  remaining: number;
}) {
  return (
    <div style={quotaBarContainerStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: isAtLimit ? "#b91c1c" : isNearLimit ? "#92400e" : "#475569" }}>
          API credits today (all keys): {apiUsed} / {quotaCap}
        </span>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>resets next UTC day (Eastern in UI)</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${Math.min(100, (apiUsed / quotaCap) * 100)}%`,
          borderRadius: 999,
          background: isAtLimit ? "#ef4444" : isNearLimit ? "#f59e0b" : "#22c55e",
          transition: "width 0.3s ease",
        }} />
      </div>
      {isNearLimit && !isAtLimit && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#92400e" }}>
          ⚠️ Only {remaining} credit{remaining === 1 ? "" : "s"} left — use Sync sparingly.
        </div>
      )}
      {isAtLimit && (
        <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>
          Quota reached. Resets at next provider day (times shown in Eastern).
        </div>
      )}
    </div>
  );
}

export default function DashboardClient({
  opponentName,
  yourPlayers,
  opponentPlayers,
  yourFantasyPlayers,
  opponentFantasyPlayers,
  rosterNames,
  squads,
  hasLinkedMatch,
  currentMatch,
}: Props) {
  const hasExistingLineup = yourPlayers.some((p) => p.name.trim()) && opponentPlayers.some((p) => p.name.trim());

  const [view, setView] = useState<"setup" | "scores">(hasExistingLineup ? "scores" : "setup");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [rival, setRival] = useState(opponentName || "Rahul");
  const [mine, setMine] = useState<Player[]>(withFallback(yourPlayers));
  const [theirs, setTheirs] = useState<Player[]>(withFallback(opponentPlayers));
  const [activeSide, setActiveSide] = useState<"mine" | "theirs">("mine");
  const [linkChoices, setLinkChoices] = useState<MatchChoice[] | null>(null);
  const [pickedLinkId, setPickedLinkId] = useState("");
  const [linkDateHint, setLinkDateHint] = useState("");
  const [fixtureListSource, setFixtureListSource] = useState<"cache" | "api" | null>(null);
  const [apiUsed, setApiUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number; label: string } | null>(null);
  const [showSyncCooldownPrompt, setShowSyncCooldownPrompt] = useState(false);
  const [showCricbuzzFallbackBtn, setShowCricbuzzFallbackBtn] = useState(false);
  const [keyStats, setKeyStats] = useState<{ alias: string; hits: number; remaining: number; blocked?: boolean }[]>([]);
  const [quotaCap, setQuotaCap] = useState(FALLBACK_QUOTA_CAP);

  const refreshKeyStatsBundle = useCallback(() => {
    fetch("/api/key-stats")
      .then((r) => r.json())
      .then((j: KeyStatsApiResponse & { stats?: typeof keyStats }) => {
        if (!j.ok) return;
        if (Array.isArray(j.stats)) setKeyStats(j.stats);
        setQuotaCap(combinedQuotaCap(j));
        const th = combinedHitsFromKeyStats(j);
        if (th != null) {
          setApiUsed(th);
          saveQuota(th);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setApiUsed(loadQuota());
    refreshKeyStatsBundle();
  }, [refreshKeyStatsBundle]);

  const addUsage = useCallback((n: number) => {
    setApiUsed((prev: number) => {
      const next = prev + n;
      saveQuota(next);
      return next;
    });
  }, []);

  const warnAt = Math.floor(quotaCap * 0.8);
  const remaining = quotaCap - apiUsed;
  const isNearLimit = apiUsed >= warnAt;
  const isAtLimit = remaining <= 0;

  const takenNames = useMemo(() => {
    const s = new Set<string>();
    for (const p of mine) if (p.name.trim()) s.add(p.name.trim().toLowerCase());
    for (const p of theirs) if (p.name.trim()) s.add(p.name.trim().toLowerCase());
    return s;
  }, [mine, theirs]);

  const canSave = useMemo(() => {
    const hasFourMine = mine.every((p: Player) => p.name.trim());
    const hasFourTheirs = theirs.every((p: Player) => p.name.trim());
    const oneCaptainMine = mine.filter((p: Player) => p.captain).length === 1;
    const oneCaptainTheirs = theirs.filter((p: Player) => p.captain).length === 1;
    return hasFourMine && hasFourTheirs && oneCaptainMine && oneCaptainTheirs;
  }, [mine, theirs]);

  const yourTotal = teamPoints(yourFantasyPlayers);
  const opponentTotal = teamPoints(opponentFantasyPlayers);
  const leader =
    yourTotal === opponentTotal
      ? "Tie"
      : yourTotal > opponentTotal
        ? `You +${yourTotal - opponentTotal}`
        : `${rival} +${opponentTotal - yourTotal}`;

  function guardedRun(cost: number, label: string, fn: () => Promise<void>) {
    if (isAtLimit && cost > 0) {
      setMessage(`API quota reached (${quotaCap}/day combined). Resets at next provider day (Eastern calendar for local display).`);
      return;
    }
    if (isNearLimit && cost > 0) {
      setPendingAction({ fn, cost, label });
      return;
    }
    void fn();
  }

  async function doSubmitSeedLink(externalMatchId: string) {
    if (!externalMatchId) { setMessage("Pick a match first."); return; }
    setSyncing(true);
    setMessage("Linking match…");
    try {
      const res = await fetch("/api/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalMatchId }),
      });
      const json = await res.json();
      const seedMid =
        json.match && typeof json.match === "object" && json.match !== null && typeof (json.match as { id?: unknown }).id === "number"
          ? (json.match as { id: number }).id
          : null;
      recordSyncDebugClient(seedMid, json as Record<string, unknown>, "dashboard-seed");
      setLinkChoices(null);
      setFixtureListSource(null);
      addUsage(1);
      refreshKeyStatsBundle();
      setMessage(json.ok ? "Match linked. Opening…" : json.error || "Could not link match.");
      if (json.ok) {
        const mid = json.match && typeof json.match.id === "number" ? json.match.id : null;
        if (mid != null) navigateToMatchAfterSeed(mid);
        else window.location.reload();
      }
    } catch {
      setMessage("Network error while linking.");
    }
    setSyncing(false);
  }

  async function submitSeedLink(externalMatchId: string) {
    guardedRun(1, "Link match", () => doSubmitSeedLink(externalMatchId));
  }

  async function loadFixtureChoicesFromServer(refresh: boolean) {
    const json = await fetchMatchesToday(refresh, { debugLabel: "dashboard-matches-today" });
    if (shouldDebitFixtureListCredits(json.source)) addUsage(2);
    refreshKeyStatsBundle();
    const parsed = parseMatchesTodayResponse(json);
    if (parsed.kind === "error") {
      setMessage(parsed.message);
      return false;
    }
    if (parsed.kind === "empty") {
      setMessage(emptyFixtureListPlainMessage(parsed.totalRaw, parsed.nonIplSample));
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
    setMessage(fixturePickerPlainMessage(parsed.choices.length, parsed.source));
    return true;
  }

  async function doStartLinkTodaysMatch() {
    setSyncing(true);
    setMessage("Loading IPL fixtures…");
    setLinkChoices(null);
    setFixtureListSource(null);
    try {
      await loadFixtureChoicesFromServer(false);
    } catch {
      setMessage("Network error loading today's matches.");
    }
    setSyncing(false);
  }

  async function doRefreshFixtureListFromApi() {
    setSyncing(true);
    setMessage("Fetching latest fixtures from API…");
    try {
      await loadFixtureChoicesFromServer(true);
    } catch {
      setMessage("Network error loading today's matches.");
    }
    setSyncing(false);
  }

  function startLinkTodaysMatch() {
    guardedRun(0, "Load IPL list (cached when available)", doStartLinkTodaysMatch);
  }

  function startRefreshFixtureListFromApi() {
    guardedRun(2, "Refresh IPL list from API (2 credits)", doRefreshFixtureListFromApi);
  }

  async function doFetchRoster() {
    setSyncing(true);
    setMessage("Fetching player roster…");
    try {
      const res = await fetch("/api/fetch-roster", { method: "POST" });
      const json = await res.json();
      if (json.source === "api") addUsage(1);
      if (json.ok) {
        setMessage(
          json.source === "cache"
            ? `Using saved roster (${json.playerCount} players). Refreshing…`
            : `Roster loaded (${json.playerCount} players). Refreshing…`,
        );
        window.setTimeout(() => window.location.reload(), 800);
      } else {
        setMessage(json.error || "Could not load roster.");
      }
    } catch {
      setMessage("Network error loading roster.");
    }
    setSyncing(false);
  }

  async function beginDashboardSyncScores() {
    if (isWithinRefreshCooldown(currentMatch?.last_synced_at)) {
      setShowSyncCooldownPrompt(true);
      return;
    }
    await doRefreshNow();
  }

  async function doRefreshNow(opts?: { force?: boolean; cricbuzzFallback?: boolean }) {
    const force = opts?.force === true || opts?.cricbuzzFallback === true;
    const cricbuzzFallback = opts?.cricbuzzFallback === true;
    setShowSyncCooldownPrompt(false);
    setSyncing(true);
    setMessage("Syncing from cricket source...");
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force, cricbuzzFallback }),
      });
      const json = await res.json();
      setSyncing(false);
      recordSyncDebugClient(null, json as Record<string, unknown>, "dashboard-refresh");
      if (json.ok) {
        addUsage(1);
        refreshKeyStatsBundle();
        const canTry = Boolean((json.debug as { canTryCricbuzzFallback?: boolean } | undefined)?.canTryCricbuzzFallback);
        setShowCricbuzzFallbackBtn(canTry);
        setMessage(json.message || "Scores updated!");
        if (!canTry) {
          window.setTimeout(() => window.location.reload(), 1200);
        }
      } else {
        setShowCricbuzzFallbackBtn(false);
        setMessage(json.error || "Refresh failed.");
      }
    } catch {
      setSyncing(false);
      setShowCricbuzzFallbackBtn(false);
      setMessage("Network error during sync.");
    }
  }

  function refreshNow() {
    guardedRun(1, "Sync scores (1 credit)", beginDashboardSyncScores);
  }

  async function saveLineup() {
    setSaving(true);
    setMessage("Saving lineup...");
    try {
      const res = await fetch("/api/lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opponentName: rival,
          yourPlayers: mine,
          opponentPlayers: theirs,
        }),
      });
      const json = await res.json();
      setSaving(false);
      if (json.ok) {
        setMessage("Lineup saved! Syncing scores...");
        setView("scores");
        window.setTimeout(() => void doRefreshNow({ force: true }), 600);
      } else {
        setMessage(json.error || "Could not save lineup.");
      }
    } catch {
      setSaving(false);
      setMessage("Network error saving lineup.");
    }
  }

  function updateCaptain(side: "mine" | "theirs", index: number) {
    const setter = side === "mine" ? setMine : setTheirs;
    setter((prev: Player[]) => prev.map((player: Player, i: number) => ({ ...player, captain: i === index })));
  }

  function clearSlot(side: "mine" | "theirs", index: number) {
    const setter = side === "mine" ? setMine : setTheirs;
    setter((prev: Player[]) =>
      prev.map((player: Player, i: number) => {
        if (i !== index) return player;
        return { name: "", captain: false };
      })
    );
  }

  function ensureOneCaptain(side: "mine" | "theirs") {
    const setter = side === "mine" ? setMine : setTheirs;
    setter((prev: Player[]) => {
      const hasCaptain = prev.some((p) => p.captain && p.name.trim());
      if (hasCaptain) return prev;
      const firstFilled = prev.findIndex((p) => p.name.trim());
      if (firstFilled === -1) return prev;
      return prev.map((p, i) => ({ ...p, captain: i === firstFilled }));
    });
  }

  function applyRosterName(name: string) {
    const list = activeSide === "mine" ? mine : theirs;
    const setter = activeSide === "mine" ? setMine : setTheirs;
    const nextEmpty = list.findIndex((p: Player) => !p.name.trim());
    if (nextEmpty === -1) {
      setMessage(`All 4 slots for ${activeSide === "mine" ? "your team" : `${rival || "opponent"}'s team`} are filled. Remove a player first.`);
      return;
    }
    setter((prev: Player[]) =>
      prev.map((p: Player, i: number) => (i === nextEmpty ? { ...p, name: name } : p))
    );
    setMessage("");
  }

  const hasRoster = rosterNames.length > 0 || squads.some((t) => t.players.length > 0);

  // ── Scores View ────────────────────────────────────────────────────────────
  if (view === "scores") {
    const fixtureName = formatFixture(currentMatch?.fixture) || currentMatch?.fixture || "No match linked";
    const lastSynced = currentMatch?.last_synced_at
      ? formatUiDateTime(currentMatch.last_synced_at)
      : "Not yet";

    return (
      <div style={{ display: "grid", gap: 20, marginBottom: 24 }}>

        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 4 }}>Current Match</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#0f172a" }}>{fixtureName}</div>
            {currentMatch?.venue && (
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>{currentMatch.venue}</div>
            )}
            {currentMatch?.live_summary && (
              <div style={{ fontSize: 14, color: "#475569", marginTop: 4 }}>{currentMatch.live_summary}</div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void startLinkTodaysMatch()}
              disabled={syncing}
              style={buttonStyleSecondary}
            >
              {syncing ? "⏳ Loading..." : "Link IPL Match"}
            </button>
            <button
              type="button"
              onClick={() => { setView("setup"); setMessage(""); }}
              style={buttonStyleSecondary}
            >
              ✎ Edit Lineup
            </button>
          </div>
        </div>

        {/* Score cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16 }}>
          <ScoreCard label="Your Points" value={yourTotal} />
          <ScoreCard label={`${rival} Points`} value={opponentTotal} />
          <ScoreCard label="Leader" value={leader} />
          <ScoreCard label="Status" value={currentMatch?.status ?? "—"} />
        </div>

        {/* Sync controls */}
        <div style={syncBarStyle}>
          <button
            type="button"
            onClick={() => void refreshNow()}
            disabled={syncing || isAtLimit}
            style={buttonStyle}
          >
            {syncing ? "Syncing..." : "⟳ Sync Scores Now"}
          </button>
          <span style={{ fontSize: 13, color: "#64748b" }}>
            Last synced: {lastSynced}
          </span>
          {message && !linkChoices && (
            <span style={{ fontSize: 13, color: "#475569" }}>{message}</span>
          )}
        </div>

        {showCricbuzzFallbackBtn && (
          <div style={{ ...syncBarStyle, flexDirection: "column", alignItems: "stretch", gap: 10, marginTop: 4 }}>
            <span style={{ fontSize: 13, color: "#64748b" }}>
              CricketData returned no scorecard rows. Pull <strong>runs and wickets</strong> from Cricbuzz (unofficial).
            </span>
            <button
              type="button"
              disabled={syncing || isAtLimit}
              style={buttonStyleSecondary}
              onClick={() => guardedRun(1, "Cricbuzz scorecard", () => doRefreshNow({ cricbuzzFallback: true }))}
            >
              {syncing ? "Loading…" : "Pull from Cricbuzz"}
            </button>
          </div>
        )}

        {showSyncCooldownPrompt && (
          <div style={{ ...quotaWarnPanelStyle, borderColor: "#bfdbfe", background: "#f0f9ff" }}>
            <div style={{ fontWeight: 700, color: "#1e40af", marginBottom: 8 }}>Recent sync</div>
            <div style={{ color: "#1e3a8a", fontSize: 14, marginBottom: 14 }}>
              Last refresh was less than 15 minutes ago. API keys are limited — sync again only if you really need the latest scores.
              {(() => {
                const m = minutesUntilRefreshAllowed(currentMatch?.last_synced_at);
                return m != null ? ` You can sync without this prompt in about ${m} minute${m === 1 ? "" : "s"}.` : "";
              })()}
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={buttonStyle} onClick={() => void doRefreshNow({ force: true })}>
                Yes, refresh anyway
              </button>
              <button
                type="button"
                style={buttonStyleSecondary}
                onClick={() => {
                  setShowSyncCooldownPrompt(false);
                  setMessage("Sync skipped — last refresh was under 15 minutes ago.");
                }}
              >
                No, keep current data
              </button>
            </div>
          </div>
        )}

        {/* Match picker — shown inline when Link IPL Match is clicked from scores view */}
        {linkChoices && linkChoices.length > 1 ? (
          <div style={pickerPanelStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose an IPL match to import</div>
            {linkDateHint ? (
              <div style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>Showing yesterday, today &amp; tomorrow (Eastern) · {linkDateHint}</div>
            ) : null}
            {fixtureListSource === "cache" && (
              <div style={{ fontSize: 12, color: "#0369a1", marginBottom: 12, padding: "8px 10px", background: "#e0f2fe", borderRadius: 8 }}>
                Using saved fixture list — no API call. Use the button below if a match is missing.
              </div>
            )}
            <div style={{ display: "grid", gap: 10 }}>
              {linkChoices.map((c: MatchChoice) => (
                <label
                  key={c.externalMatchId || c.fixture}
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "flex-start",
                    padding: 12,
                    borderRadius: 12,
                    border: pickedLinkId === c.externalMatchId ? "2px solid #2563eb" : "1px solid #e2e8f0",
                    background: pickedLinkId === c.externalMatchId ? "#eff6ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="linkpick-scores"
                    checked={pickedLinkId === c.externalMatchId}
                    onChange={() => setPickedLinkId(c.externalMatchId || "")}
                    style={{ marginTop: 4 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: "#0f172a" }}>{formatFixture(c.fixture) || c.fixture}</div>
                    <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                      {c.status}{c.venue ? ` · ${c.venue}` : ""}{c.match_date ? ` · ${c.match_date}` : ""}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => void submitSeedLink(pickedLinkId)}
                disabled={syncing || !pickedLinkId}
                style={buttonStyle}
              >
                {syncing ? "Working…" : "Link selected match"}
              </button>
              <button
                type="button"
                onClick={() => { setLinkChoices(null); setMessage(""); setFixtureListSource(null); }}
                disabled={syncing}
                style={buttonStyleSecondary}
              >
                Cancel
              </button>
            </div>
            {fixtureListSource === "cache" && (
              <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Fixture not listed? Pull the latest IPL list from CricAPI (uses ~2 API credits).</div>
                <button
                  type="button"
                  onClick={() => void startRefreshFixtureListFromApi()}
                  disabled={syncing}
                  style={buttonStyleSecondary}
                >
                  {syncing ? "Loading…" : "Refresh list from API"}
                </button>
              </div>
            )}
          </div>
        ) : null}

        {/* Quota warning confirmation */}
        {pendingAction ? (
          <div style={quotaWarnPanelStyle}>
            <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚠️ Low on API credits</div>
            <div style={{ color: "#78350f", fontSize: 14, marginBottom: 14 }}>
            You have <strong>{remaining} credit{remaining === 1 ? "" : "s"}</strong> remaining today (combined across keys).
            This action uses <strong>{pendingAction.cost}</strong>. Proceed?
          </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                style={buttonStyle}
                onClick={() => { const a = pendingAction; setPendingAction(null); void a.fn(); }}
              >
                Yes, use {pendingAction.cost} credit{pendingAction.cost > 1 ? "s" : ""}
              </button>
              <button type="button" style={buttonStyleSecondary} onClick={() => setPendingAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        {/* Player tables */}
        {yourFantasyPlayers.length > 0 || opponentFantasyPlayers.length > 0 ? (
          <div style={{ display: "grid", gap: 16 }}>
            <PlayerTable title="Your Team" players={yourFantasyPlayers} />
            <PlayerTable title={`${rival} Team`} players={opponentFantasyPlayers} />
          </div>
        ) : (
          <div style={{ ...panelStyle, color: "#64748b", textAlign: "center", padding: 32 }}>
            No scores yet — click <strong>Sync Scores Now</strong> above to load the latest data.
          </div>
        )}

        {/* Compact quota bar */}
        <QuotaBar apiUsed={apiUsed} quotaCap={quotaCap} isNearLimit={isNearLimit} isAtLimit={isAtLimit} remaining={remaining} />
        {anyKeyBlocked(keyStats) && (
          <div style={{ fontSize: 12, color: "#92400e", marginTop: 8 }}>
            Some keys are rate-limited or at daily cap —{" "}
            <button type="button" style={{ textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#b45309" }} onClick={() => void fetch("/api/reset-key-blocks", { method: "POST" }).then(() => refreshKeyStatsBundle())}>
              try clearing blocks
            </button>
            {" "}or open <a href="/api/key-stats" target="_blank" rel="noreferrer">key stats</a>.
          </div>
        )}

      </div>
    );
  }

  // ── Setup View ─────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>

      {/* Setup header with back button if lineup exists */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 18, color: "#0f172a" }}>Player Selection</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Pick 4 players each and mark 1 as Team Captain (points ×2).</div>
        </div>
        {hasExistingLineup && (
          <button
            type="button"
            onClick={() => { setView("scores"); setMessage(""); }}
            style={buttonStyleSecondary}
          >
            ← Back to Scores
          </button>
        )}
      </div>

      {/* Quota bar */}
      <QuotaBar apiUsed={apiUsed} quotaCap={quotaCap} isNearLimit={isNearLimit} isAtLimit={isAtLimit} remaining={remaining} />
      {anyKeyBlocked(keyStats) && (
        <div style={{ fontSize: 12, color: "#92400e", marginTop: 8 }}>
          Some keys are rate-limited or at daily cap —{" "}
          <button type="button" style={{ textDecoration: "underline", background: "none", border: "none", cursor: "pointer", padding: 0, color: "#b45309" }} onClick={() => void fetch("/api/reset-key-blocks", { method: "POST" }).then(() => refreshKeyStatsBundle())}>
            try clearing blocks
          </button>
          {" "}or open <a href="/api/key-stats" target="_blank" rel="noreferrer">key stats</a>.
        </div>
      )}

      {/* Quota warning confirmation */}
      {pendingAction ? (
        <div style={quotaWarnPanelStyle}>
          <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚠️ Low on API credits</div>
          <div style={{ color: "#78350f", fontSize: 14, marginBottom: 14 }}>
            You have <strong>{remaining} credit{remaining === 1 ? "" : "s"}</strong> remaining today.
            This action uses <strong>{pendingAction.cost}</strong>. Proceed?
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => { const a = pendingAction; setPendingAction(null); void a.fn(); }}
            >
              Yes, use {pendingAction.cost} credit{pendingAction.cost > 1 ? "s" : ""}
            </button>
            <button type="button" style={buttonStyleSecondary} onClick={() => setPendingAction(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/* Match linking button + inline status */}
      <div style={syncBarStyle}>
        <button onClick={() => void startLinkTodaysMatch()} disabled={syncing} style={buttonStyle}>
          {syncing ? "⏳ Loading matches..." : "Link IPL Match"}
        </button>
        {message && !linkChoices && (
          <span style={{ fontSize: 13, color: "#475569" }}>{message}</span>
        )}
      </div>

      {/* Match picker popup */}
      {linkChoices && linkChoices.length > 1 ? (
        <div style={pickerPanelStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose an IPL match to import</div>
          {linkDateHint ? (
            <div style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>Showing yesterday, today &amp; tomorrow (India time) · {linkDateHint}</div>
          ) : null}
          {fixtureListSource === "cache" && (
            <div style={{ fontSize: 12, color: "#0369a1", marginBottom: 12, padding: "8px 10px", background: "#e0f2fe", borderRadius: 8 }}>
              Using saved fixture list — no API call. Use the button below if a match is missing.
            </div>
          )}
          <div style={{ display: "grid", gap: 10 }}>
            {linkChoices.map((c: MatchChoice) => (
              <label
                key={c.externalMatchId || c.fixture}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  padding: 12,
                  borderRadius: 12,
                  border: pickedLinkId === c.externalMatchId ? "2px solid #2563eb" : "1px solid #e2e8f0",
                  background: pickedLinkId === c.externalMatchId ? "#eff6ff" : "white",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="linkpick"
                  checked={pickedLinkId === c.externalMatchId}
                  onChange={() => setPickedLinkId(c.externalMatchId || "")}
                  style={{ marginTop: 4 }}
                />
                <div>
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{formatFixture(c.fixture) || c.fixture}</div>
                  <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                    {c.status}
                    {c.venue ? ` · ${c.venue}` : ""}
                    {c.match_date ? ` · ${c.match_date}` : ""}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void submitSeedLink(pickedLinkId)}
              disabled={syncing || !pickedLinkId}
              style={buttonStyle}
            >
              {syncing ? "Working…" : "Link selected match"}
            </button>
            <button
              type="button"
              onClick={() => { setLinkChoices(null); setMessage(""); setFixtureListSource(null); }}
              disabled={syncing}
              style={buttonStyleSecondary}
            >
              Cancel
            </button>
          </div>
          {fixtureListSource === "cache" && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Fixture not listed? Pull the latest IPL list from CricAPI (uses ~2 API credits).</div>
              <button
                type="button"
                onClick={() => void startRefreshFixtureListFromApi()}
                disabled={syncing}
                style={buttonStyleSecondary}
              >
                {syncing ? "Loading…" : "Refresh list from API"}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* Roster panel */}
      <div style={rosterPanelStyle}>
        <h3 style={{ marginTop: 0 }}>Players in this match</h3>

        {!hasLinkedMatch ? (
          <div style={{ color: "#64748b", fontSize: 14 }}>Use &quot;Link IPL Match&quot; to import a recent fixture first.</div>
        ) : !hasRoster ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ color: "#64748b", fontSize: 14 }}>
              No roster loaded yet. The squad is usually available a few hours before match time.
            </div>
            <button
              type="button"
              onClick={() => void doFetchRoster()}
              disabled={syncing}
              style={buttonStyle}
            >
              {syncing ? "Loading…" : "Load Player Roster"}
            </button>
          </div>
        ) : (
          <>
            {/* Side toggle */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "#475569", marginBottom: 8 }}>
                Tap a player to add them to the selected side&apos;s next empty slot. Players already in a lineup are greyed out.
              </div>
              <div style={{ display: "flex", gap: 0, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", width: "fit-content" }}>
                <button
                  type="button"
                  onClick={() => setActiveSide("mine")}
                  style={sideTabStyle(activeSide === "mine")}
                >
                  + Your Team
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSide("theirs")}
                  style={sideTabStyle(activeSide === "theirs")}
                >
                  + {rival || "Opponent"}&apos;s Team
                </button>
              </div>
            </div>

            {squads.length > 0 ? (
              <div style={{ display: "grid", gap: 16 }}>
                {squads.map((team) => (
                  <div key={team.teamName}>
                    <div style={{ fontWeight: 700, marginBottom: 8, color: "#334155" }}>{team.teamName}</div>
                    <div style={chipGridStyle}>
                      {team.players.map((name) => {
                        const taken = takenNames.has(name.trim().toLowerCase());
                        return (
                          <button
                            key={`${team.teamName}-${name}`}
                            type="button"
                            style={taken ? chipStyleTaken : chipStyle}
                            disabled={taken}
                            onClick={() => applyRosterName(name)}
                            title={taken ? "Already in a lineup" : `Add to ${activeSide === "mine" ? "your" : `${rival || "opponent"}'s`} team`}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={chipGridStyle}>
                {rosterNames.map((name) => {
                  const taken = takenNames.has(name.trim().toLowerCase());
                  return (
                    <button
                      key={name}
                      type="button"
                      style={taken ? chipStyleTaken : chipStyle}
                      disabled={taken}
                      onClick={() => applyRosterName(name)}
                      title={taken ? "Already in a lineup" : `Add to ${activeSide === "mine" ? "your" : `${rival || "opponent"}'s`} team`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Lineup panel */}
      <div style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Lineups</h3>
        <div style={{ color: "#475569", marginBottom: 16, fontSize: 14 }}>
          Pick 4 players from the list above. Mark exactly 1 <strong>Team Captain</strong> per side — their points are doubled.
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Opponent name</label>
          <input value={rival} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRival(e.target.value)} style={inputStyle} placeholder="Opponent name" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          {/* Your side */}
          <div>
            <div style={sectionTitleStyle}>Your 4 players</div>
            {mine.map((player: Player, index: number) => (
              <div key={`mine-${index}`} style={rowStyle}>
                <div style={slotNumberStyle}>{index + 1}</div>
                {player.name.trim() ? (
                  <>
                    <span style={slotNameStyle}>{player.name}</span>
                    <label style={captainLabelStyle} title="Set as Team Captain (points ×2)">
                      <input
                        type="radio"
                        name="mine-captain"
                        checked={player.captain}
                        onChange={() => updateCaptain("mine", index)}
                      />
                      <span style={{ color: player.captain ? "#d97706" : "#94a3b8" }}>★ Captain</span>
                    </label>
                    <button
                      type="button"
                      style={clearBtnStyle}
                      onClick={() => { clearSlot("mine", index); ensureOneCaptain("mine"); }}
                      title="Remove player"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <span style={emptySlotStyle}>
                    {activeSide === "mine" ? "← tap a player above" : "empty"}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Their side */}
          <div>
            <div style={sectionTitleStyle}>{rival || "Opponent"}&apos;s 4 players</div>
            {theirs.map((player: Player, index: number) => (
              <div key={`their-${index}`} style={rowStyle}>
                <div style={slotNumberStyle}>{index + 1}</div>
                {player.name.trim() ? (
                  <>
                    <span style={slotNameStyle}>{player.name}</span>
                    <label style={captainLabelStyle} title="Set as Team Captain (points ×2)">
                      <input
                        type="radio"
                        name="theirs-captain"
                        checked={player.captain}
                        onChange={() => updateCaptain("theirs", index)}
                      />
                      <span style={{ color: player.captain ? "#d97706" : "#94a3b8" }}>★ Captain</span>
                    </label>
                    <button
                      type="button"
                      style={clearBtnStyle}
                      onClick={() => { clearSlot("theirs", index); ensureOneCaptain("theirs"); }}
                      title="Remove player"
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <span style={emptySlotStyle}>
                    {activeSide === "theirs" ? "← tap a player above" : "empty"}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={saveLineup} disabled={!canSave || saving} style={buttonStyle}>
            {saving ? "Saving..." : "Save Lineups"}
          </button>
          {message ? <span style={{ color: "#475569" }}>{message}</span> : null}
        </div>
      </div>

    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const panelStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 20,
  background: "white",
  padding: 20,
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
};

const syncBarStyle: CSSProperties = {
  display: "flex",
  gap: 14,
  alignItems: "center",
  flexWrap: "wrap",
  padding: "16px 18px",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  boxShadow: "var(--shadow-xs)",
};

const buttonStyle: CSSProperties = {
  padding: "11px 20px",
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  boxShadow: "0 2px 14px rgba(37,99,235,0.32), 0 1px 2px rgba(0,0,0,0.06)",
};

const buttonStyleSecondary: CSSProperties = {
  padding: "11px 20px",
  borderRadius: 14,
  border: "1px solid var(--border-strong)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 14,
  boxShadow: "var(--shadow-xs)",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  color: "#475569",
  fontSize: 14,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  border: "1px solid var(--border-strong)",
  borderRadius: 12,
  marginBottom: 12,
  boxSizing: "border-box",
  background: "var(--surface)",
  fontSize: 15,
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 10,
  minHeight: 42,
};

const sectionTitleStyle: CSSProperties = {
  fontWeight: 700,
  marginBottom: 12,
};

const rosterPanelStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 20,
  background: "linear-gradient(180deg, var(--surface-muted) 0%, var(--surface) 100%)",
  padding: 22,
  boxShadow: "var(--shadow-xs)",
};

const pickerPanelStyle: CSSProperties = {
  border: "1px solid rgba(59, 130, 246, 0.35)",
  borderRadius: 20,
  background: "linear-gradient(180deg, #eff6ff 0%, #f8fafc 100%)",
  padding: 22,
  boxShadow: "0 4px 24px rgba(37, 99, 235, 0.08), var(--shadow-xs)",
};

const quotaBarContainerStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 16,
  background: "var(--surface)",
  padding: "14px 18px",
  boxShadow: "var(--shadow-xs)",
};

const quotaWarnPanelStyle: CSSProperties = {
  border: "2px solid #fcd34d",
  borderRadius: 16,
  background: "#fffbeb",
  padding: 16,
};

const chipGridStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
};

const chipStyle: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#0f172a",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 500,
};

const chipStyleTaken: CSSProperties = {
  ...chipStyle,
  background: "#f1f5f9",
  color: "#94a3b8",
  border: "1px solid #e2e8f0",
  cursor: "not-allowed",
  textDecoration: "line-through",
};

const slotNumberStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  background: "#e2e8f0",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 700,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const slotNameStyle: CSSProperties = {
  flex: 1,
  fontWeight: 500,
  color: "#0f172a",
  fontSize: 14,
};

const emptySlotStyle: CSSProperties = {
  flex: 1,
  color: "#94a3b8",
  fontSize: 13,
  fontStyle: "italic",
};

const captainLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  cursor: "pointer",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const clearBtnStyle: CSSProperties = {
  padding: "4px 8px",
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fff1f2",
  color: "#ef4444",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
};

function sideTabStyle(active: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    border: "none",
    background: active ? "#0f172a" : "white",
    color: active ? "white" : "#475569",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 13,
  };
}
