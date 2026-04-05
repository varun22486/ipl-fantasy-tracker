"use client";

import React, { useEffect, useMemo, useState, useCallback, type CSSProperties } from "react";
import { formatFixture } from "@/lib/format";
import { formatUiCalendarDate, formatUiDateTime } from "@/lib/ui-time";
import ScoreCard from "@/components/ScoreCard";
import PlayerTable from "@/components/PlayerTable";
import { FantasyPlayer, teamPoints } from "@/lib/scoring";
import { navigateToMatchAfterSeed } from "@/lib/post-seed-nav-client";

const KEY_LIMIT = 100;          // CricAPI free plan per key per day
const QUOTA_LIMIT = 1100; // 100/day × 11 API keys (CRICKET_API_KEY … _11)
const QUOTA_WARN_AT = 640; // warn at 80% of 800
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

type MatchChoice = {
  externalMatchId?: string;
  fixture: string;
  status: string;
  venue?: string | null;
  match_date: string;
  live_summary?: string | null;
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

type DebugData = {
  message?: string;
  skipped?: boolean;
  reason?: string;
  live_summary?: string;
  error?: string;
  debug?: {
    selectedCount?: number;
    providerRowCount?: number;
    updatedRows?: number;
    unmatched?: string[];
    matched?: Array<{ selected: string; provider: string }>;
    providerPlayersSample?: string[];
    lastSyncedAt?: string;
    syncedAt?: string;
    sourceUrl?: string | null;
    status?: string;
    rosterCount?: number;
  };
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

function DebugPanel({ info }: { info: DebugData | null }) {
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const details = info.debug;
  return (
    <div style={debugPanelStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700, color: "#64748b", padding: 0, marginBottom: open ? 8 : 0 }}
      >
        {open ? "▾" : "▸"} Sync debug
      </button>
      {open && (
        <>
          <div style={{ color: info.error ? "#b91c1c" : "#334155", marginBottom: 10 }}>
            {info.error || info.reason || info.message || "No details yet."}
          </div>
          {info.live_summary ? <div style={debugLineStyle}><strong>Live summary:</strong> {info.live_summary}</div> : null}
          {typeof details?.updatedRows === "number" ? (
            <div style={debugLineStyle}>
              <strong>Matched selected players:</strong> {details.updatedRows} / {details.selectedCount ?? 0}
            </div>
          ) : null}
          {typeof details?.providerRowCount === "number" ? (
            <div style={debugLineStyle}>
              <strong>Provider rows found:</strong> {details.providerRowCount}
            </div>
          ) : null}
          {details?.status ? <div style={debugLineStyle}><strong>Provider status:</strong> {details.status}</div> : null}
          {details?.syncedAt || details?.lastSyncedAt ? (
            <div style={debugLineStyle}>
              <strong>Sync time:</strong> {formatUiDateTime(String(details.syncedAt || details.lastSyncedAt))}
            </div>
          ) : null}
          {details?.unmatched?.length ? (
            <div style={debugLineStyle}>
              <strong>Unmatched:</strong> {details.unmatched.join(", ")}
            </div>
          ) : null}
          {details?.matched?.length ? (
            <div style={debugLineStyle}>
              <strong>Name matches:</strong> {details.matched.map((m) => `${m.selected} → ${m.provider}`).join(", ")}
            </div>
          ) : null}
          {details?.providerPlayersSample?.length ? (
            <div style={debugLineStyle}>
              <strong>Provider sample:</strong> {details.providerPlayersSample.join(", ")}
            </div>
          ) : null}
          {details?.sourceUrl ? (
            <div style={debugLineStyle}>
              <strong>Source URL:</strong> <a href={details.sourceUrl} target="_blank" rel="noreferrer">{details.sourceUrl}</a>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function QuotaBar({
  apiUsed,
  isNearLimit,
  isAtLimit,
  remaining,
  keyStats,
}: {
  apiUsed: number;
  isNearLimit: boolean;
  isAtLimit: boolean;
  remaining: number;
  keyStats: { alias: string; hits: number; remaining: number }[];
}) {
  return (
    <div style={quotaBarContainerStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: isAtLimit ? "#b91c1c" : isNearLimit ? "#92400e" : "#475569" }}>
          API credits today: {apiUsed} / {QUOTA_LIMIT}
        </span>
        <span style={{ fontSize: 12, color: "#94a3b8" }}>resets midnight Eastern (per key / provider day)</span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${Math.min(100, (apiUsed / QUOTA_LIMIT) * 100)}%`,
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
      {keyStats.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
          {keyStats.map((k, i) => {
            const pct = k.hits / KEY_LIMIT;
            const color = pct >= 1 ? "#ef4444" : pct >= 0.8 ? "#f59e0b" : "#22c55e";
            return (
              <div key={k.alias} style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontWeight: 600, color: "#475569" }}>Key {i + 1}</span>
                <span style={{ display: "inline-block", width: 40, height: 4, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.min(100, pct * 100)}%`, background: color, borderRadius: 999 }} />
                </span>
                <span style={{ color }}>{k.hits}/{KEY_LIMIT}</span>
              </div>
            );
          })}
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
  const [debugInfo, setDebugInfo] = useState<DebugData | null>(null);
  const [rival, setRival] = useState(opponentName || "Rahul");
  const [mine, setMine] = useState<Player[]>(withFallback(yourPlayers));
  const [theirs, setTheirs] = useState<Player[]>(withFallback(opponentPlayers));
  const [activeSide, setActiveSide] = useState<"mine" | "theirs">("mine");
  const [linkChoices, setLinkChoices] = useState<MatchChoice[] | null>(null);
  const [pickedLinkId, setPickedLinkId] = useState("");
  const [linkDateHint, setLinkDateHint] = useState("");
  const [apiUsed, setApiUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number; label: string } | null>(null);
  const [keyStats, setKeyStats] = useState<{ alias: string; hits: number; remaining: number }[]>([]);

  useEffect(() => {
    setApiUsed(loadQuota());
    fetch("/api/key-stats")
      .then((r) => r.json())
      .then((j) => { if (j.ok && Array.isArray(j.stats)) setKeyStats(j.stats); })
      .catch(() => {});
  }, []);

  const addUsage = useCallback((n: number) => {
    setApiUsed((prev: number) => {
      const next = prev + n;
      saveQuota(next);
      return next;
    });
  }, []);

  const remaining = QUOTA_LIMIT - apiUsed;
  const isNearLimit = apiUsed >= QUOTA_WARN_AT;
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
    if (isAtLimit) {
      setMessage(`API quota reached (${QUOTA_LIMIT}/day). Resets at next provider day (Eastern calendar for local display).`);
      return;
    }
    if (isNearLimit) {
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
      setDebugInfo(json);
      setLinkChoices(null);
      addUsage(1);
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

  async function doStartLinkTodaysMatch() {
    setSyncing(true);
    setMessage("Loading today's IPL fixtures…");
    setLinkChoices(null);
    try {
      const res = await fetch("/api/matches/today");
      const json = await res.json();
      setDebugInfo(json);
      addUsage(2);
      if (!json.ok) {
        setMessage(json.error || "Could not load today's matches.");
        setSyncing(false);
        return;
      }
      setLinkDateHint(typeof json.date === "string" ? json.date : "");
      const choices: MatchChoice[] = Array.isArray(json.choices) ? json.choices : [];
      if (choices.length === 0) {
        const sample: string[] = Array.isArray(json.nonIplSample) ? json.nonIplSample : [];
        let hint = "";
        if (typeof json.totalRaw !== "number" || json.totalRaw === 0) {
          hint = "API returned 0 matches. Keys may be rate-limited (wait ~15 min) or daily quota is used up (resets at next UTC day; UI times are Eastern).";
        } else {
          hint = `${json.totalRaw} matches in feed but none are IPL yet. Current feed has: ${sample.length > 0 ? sample.join(", ") : "non-IPL tournaments"}. IPL 2026 may not have started yet.`;
        }
        setMessage(hint);
        setSyncing(false);
        return;
      }
      if (choices.length === 1) {
        await doSubmitSeedLink(choices[0].externalMatchId || "");
        return;
      }
      setLinkChoices(choices);
      setPickedLinkId(choices[0].externalMatchId || "");
      setMessage(`${choices.length} IPL fixture${choices.length > 1 ? "s" : ""} found — pick one below.`);
    } catch {
      setMessage("Network error loading today's matches.");
    }
    setSyncing(false);
  }

  function startLinkTodaysMatch() {
    guardedRun(2, "Load today's matches (2 credits)", doStartLinkTodaysMatch);
  }

  async function doFetchRoster() {
    setSyncing(true);
    setMessage("Fetching player roster…");
    try {
      const res = await fetch("/api/fetch-roster", { method: "POST" });
      const json = await res.json();
      addUsage(1);
      if (json.ok) {
        setMessage(`Roster loaded (${json.playerCount} players). Refreshing…`);
        window.setTimeout(() => window.location.reload(), 800);
      } else {
        setMessage(json.error || "Could not load roster.");
      }
    } catch {
      setMessage("Network error loading roster.");
    }
    setSyncing(false);
  }

  async function doRefreshNow() {
    setSyncing(true);
    setMessage("Syncing from cricket source...");
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const json = await res.json();
      setSyncing(false);
      setDebugInfo(json);
      if (!json.skipped) addUsage(1);
      if (json.ok) {
        setMessage(json.reason || json.message || (json.skipped ? "Using cached data." : "Scores updated!"));
        if (!json.skipped) window.setTimeout(() => window.location.reload(), 1200);
      } else {
        setMessage(json.error || "Refresh failed.");
      }
    } catch {
      setSyncing(false);
      setMessage("Network error during sync.");
    }
  }

  function refreshNow() {
    guardedRun(1, "Sync scores (1 credit)", doRefreshNow);
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
        window.setTimeout(() => void doRefreshNow(), 600);
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
              disabled={syncing || isAtLimit}
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

        {/* Match picker — shown inline when Link IPL Match is clicked from scores view */}
        {linkChoices && linkChoices.length > 1 ? (
          <div style={pickerPanelStyle}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose an IPL match to import</div>
            {linkDateHint ? (
              <div style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>Showing yesterday, today &amp; tomorrow (Eastern) · {linkDateHint}</div>
            ) : null}
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
                onClick={() => { setLinkChoices(null); setMessage(""); }}
                disabled={syncing}
                style={buttonStyleSecondary}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

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

        {/* Debug panel (collapsed by default) */}
        <DebugPanel info={debugInfo} />

        {/* Compact quota bar */}
        <QuotaBar
          apiUsed={apiUsed}
          isNearLimit={isNearLimit}
          isAtLimit={isAtLimit}
          remaining={remaining}
          keyStats={keyStats}
        />
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
      <QuotaBar
        apiUsed={apiUsed}
        isNearLimit={isNearLimit}
        isAtLimit={isAtLimit}
        remaining={remaining}
        keyStats={keyStats}
      />

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
        <button onClick={() => void startLinkTodaysMatch()} disabled={syncing || isAtLimit} style={buttonStyle}>
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
              onClick={() => { setLinkChoices(null); setMessage(""); }}
              disabled={syncing}
              style={buttonStyleSecondary}
            >
              Cancel
            </button>
          </div>
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

      <DebugPanel info={debugInfo} />
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

const debugPanelStyle: CSSProperties = {
  border: "1px solid #dbeafe",
  borderRadius: 16,
  background: "#f8fbff",
  padding: "12px 16px",
};

const debugLineStyle: CSSProperties = {
  color: "#334155",
  marginBottom: 8,
  wordBreak: "break-word",
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
