"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { formatFixture } from "@/lib/format";
import { formatUiCalendarDate } from "@/lib/ui-time";
import type { CSSProperties } from "react";
import ApiMessage from "@/components/ApiMessage";
import { classifyApiMsg, type ApiMsg } from "@/lib/api-message";

const KEY_LIMIT = 100;
const QUOTA_LIMIT = 800; // 100/day × 8 API keys (CRICKET_API_KEY … _8)
const QUOTA_WARN_AT = 640; // warn at 80% of 800
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

/** Sort A–Z by first name (first word), then full name */
function sortRosterByFirstName(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ta = a.trim();
    const tb = b.trim();
    const fa = (ta.split(/\s+/)[0] ?? "").toLowerCase();
    const fb = (tb.split(/\s+/)[0] ?? "").toLowerCase();
    const c = fa.localeCompare(fb, undefined, { sensitivity: "base" });
    if (c !== 0) return c;
    return ta.localeCompare(tb, undefined, { sensitivity: "base" });
  });
}

/** Player chips when there is no squad split (single combined list) */
const rosterPlayerGrid2: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

/** One column of players stacked under each team header */
const rosterPlayersBelowTeam: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  gap: 8,
};

type Player = { name: string; captain: boolean; providerId?: string };
type SquadTeam = { teamName: string; players: string[] };
type MatchChoice = { externalMatchId?: string; fixture: string; status: string; venue?: string | null; match_date: string };

type Props = {
  yourName: string;
  opponentName: string;
  yourPlayers: Player[];
  opponentPlayers: Player[];
  rosterNames: string[];
  squads: SquadTeam[];
  /** lowercase player name → CricAPI UUID; used to save provider_player_id at lineup time */
  nameToId: Record<string, string>;
  hasLinkedMatch: boolean;
  /** DB match row — scopes roster fetch to this fixture */
  matchId?: number | null;
  /** null = default (series_settings) competition; number = named competition */
  competitionId?: number | null;
  /**
   * Full participant list for multi-player competitions (3+).
   * When provided, renders one lineup card per participant instead of mine/theirs.
   */
  compPlayers?: string[];
  /** Existing picks per participant (indexed same as compPlayers) */
  existingPicks?: Player[][];
};

function emptyPlayers() { return Array.from({ length: 4 }, () => ({ name: "", captain: false })); }
function withFallback(players: Player[]) {
  const next = emptyPlayers();
  for (let i = 0; i < Math.min(players.length, 4); i++) next[i] = players[i];
  if (!next.some((p) => p.captain) && next[0]) next[0].captain = true;
  return next;
}

export default function SelectClient({ yourName, opponentName, yourPlayers, opponentPlayers, rosterNames, squads, nameToId, hasLinkedMatch, matchId, competitionId, compPlayers, existingPicks }: Props) {
  // Multi-player mode: 3+ participants
  const isMulti = (compPlayers?.length ?? 0) >= 3;
  const multiPlayers = compPlayers ?? [];
  // Per-participant picks array (mirrors compPlayers indices)
  const [allPicks, setAllPicks] = React.useState<Player[][]>(() =>
    multiPlayers.map((_, i) => withFallback(existingPicks?.[i] ?? []))
  );
  const [activeMultiIdx, setActiveMultiIdx] = React.useState(0);
  const [savingIdx, setSavingIdx] = React.useState<number | null>(null);
  // Track which participants are saved in this session (without reloading between each)
  const [savedSet, setSavedSet] = React.useState<Set<number>>(() => {
    const s = new Set<number>();
    // Pre-mark participants who already have picks from the DB
    if (existingPicks) {
      existingPicks.forEach((picks, i) => { if (picks.length > 0) s.add(i); });
    }
    return s;
  });

  async function saveParticipant(idx: number) {
    const picks = allPicks[idx];
    const name = multiPlayers[idx];
    if (!picks.every(p => p.name.trim()) || picks.filter(p => p.captain).length !== 1) return;
    setSavingIdx(idx); setApiMsg(null);
    try {
      const res = await fetch("/api/lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: name, players: picks, competitionId: competitionId ?? null }),
      });
      const json = await res.json();
      setSavingIdx(null);
      if (json.ok) {
        const newSaved = new Set(savedSet).add(idx);
        setSavedSet(newSaved);
        const allDone = newSaved.size >= multiPlayers.length;
        if (allDone) {
          // All participants saved — go to live view
          setApiMsg({ type: "success", title: "All teams saved! Loading match…" });
          window.setTimeout(() => window.location.reload(), 1000);
        } else {
          // Mark saved, auto-advance to next unsaved participant
          const nextUnsaved = multiPlayers.findIndex((_, i) => !newSaved.has(i));
          setApiMsg({ type: "success", title: `${name}'s team saved! ${multiPlayers.length - newSaved.size} more to go.` });
          if (nextUnsaved !== -1) setActiveMultiIdx(nextUnsaved);
        }
      } else {
        setApiMsg({ type: "error", title: json.error || "Could not save." });
      }
    } catch { setSavingIdx(null); setApiMsg({ type: "error", title: "Network error saving lineup." }); }
  }

  function updateMultiCaptain(idx: number, slotIdx: number) {
    setAllPicks(prev => prev.map((picks, i) =>
      i !== idx ? picks : picks.map((p, j) => ({ ...p, captain: j === slotIdx }))
    ));
  }
  function clearMultiSlot(idx: number, slotIdx: number) {
    setAllPicks(prev => prev.map((picks, i) =>
      i !== idx ? picks : picks.map((p, j) => j !== slotIdx ? p : { name: "", captain: false })
    ));
    // ensure still one captain
    setAllPicks(prev => {
      const picks = [...prev[idx]];
      if (!picks.some(p => p.captain && p.name.trim())) {
        const first = picks.findIndex(p => p.name.trim());
        if (first !== -1) picks[first] = { ...picks[first], captain: true };
      }
      return prev.map((p, i) => i === idx ? picks : p);
    });
  }
  function applyMultiRoster(name: string) {
    const picks = allPicks[activeMultiIdx];
    const next = picks.findIndex(p => !p.name.trim());
    if (next === -1) { setApiMsg({ type: "warning", title: "All 4 slots full", detail: "Remove one first." }); return; }
    const providerId = nameToId[name.toLowerCase()] || undefined;
    setAllPicks(prev => prev.map((p, i) =>
      i !== activeMultiIdx ? p : p.map((slot, j) => j !== next ? slot : { ...slot, name, providerId })
    ));
  }
  const [saving, setSaving] = useState<"mine" | "theirs" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [apiMsg, setApiMsg] = useState<ApiMsg | null>(null);
  const [rival, setRival] = useState(opponentName || "Rahul");
  const [mine, setMine] = useState<Player[]>(withFallback(yourPlayers));
  const [theirs, setTheirs] = useState<Player[]>(withFallback(opponentPlayers));
  const [activeSide, setActiveSide] = useState<"mine" | "theirs">("mine");
  const [linkChoices, setLinkChoices] = useState<MatchChoice[] | null>(null);
  const [pickedLinkId, setPickedLinkId] = useState("");
  const [linkDateHint, setLinkDateHint] = useState("");
  const [apiUsed, setApiUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number } | null>(null);
  const [keyStats, setKeyStats] = useState<{
    alias: string; hits: number; blocked?: boolean; blockReason?: string | null;
    resumesInMin?: number | null; staleQuotaFlag?: boolean;
  }[]>([]);
  const [resettingBlocks, setResettingBlocks] = useState(false);

  const refreshKeyStats = useCallback(() => {
    fetch("/api/key-stats").then((r) => r.json()).then((j) => { if (j.ok && Array.isArray(j.stats)) setKeyStats(j.stats); }).catch(() => {});
  }, []);

  useEffect(() => {
    setApiUsed(loadQuota());
    refreshKeyStats();
  }, [refreshKeyStats]);

  const addUsage = useCallback((n: number) => {
    setApiUsed((prev) => { const next = prev + n; saveQuota(next); return next; });
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

  const canSaveMine = mine.every((p) => p.name.trim()) && mine.filter((p) => p.captain).length === 1;
  const canSaveTheirs = theirs.every((p) => p.name.trim()) && theirs.filter((p) => p.captain).length === 1;

  const hasRoster = rosterNames.length > 0 || squads.some((t) => t.players.length > 0);

  const showMsg = useCallback((text: string, context?: string) => {
    setApiMsg(classifyApiMsg(text, context));
    setMessage(""); // clear the old plain string
  }, []);

  function guardedRun(cost: number, fn: () => Promise<void>) {
    if (isAtLimit) {
      setApiMsg(classifyApiMsg("Daily API quota exhausted", "Quota"));
      return;
    }
    if (isNearLimit) { setPendingAction({ fn, cost }); return; }
    void fn();
  }

  async function doSubmitSeedLink(externalMatchId: string) {
    if (!externalMatchId) { showMsg("Pick a match first.", "Link"); return; }
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Linking match…" });
    try {
      const res = await fetch("/api/seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalMatchId }) });
      const json = await res.json();
      setLinkChoices(null); addUsage(1);
      showMsg(json.ok ? "Match linked! Refreshing…" : (json.error || "Could not link match."), "Link match");
      if (json.ok) window.location.reload();
    } catch { showMsg("Network error while linking.", "Link match"); }
    setSyncing(false);
  }

  async function doStartLinkTodaysMatch() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Loading IPL fixtures…" });
    setLinkChoices(null);
    try {
      const res = await fetch("/api/matches/today");
      const json = await res.json();
      addUsage(2);
      if (!json.ok) { showMsg(json.error || "Could not load matches.", "Load fixtures"); setSyncing(false); return; }
      setLinkDateHint(typeof json.date === "string" ? json.date : "");
      const choices: MatchChoice[] = Array.isArray(json.choices) ? json.choices : [];
      if (choices.length === 0) {
        const total = json.totalRaw ?? 0;
        setApiMsg({
          type: "info",
          title: total === 0
            ? "No matches returned by the API right now"
            : `${total} match${total === 1 ? "" : "es"} in feed but none identified as IPL`,
          detail: total === 0
            ? "The CricAPI feed is empty — this can happen between match days or when all keys are rate-limited. Try again in a few minutes."
            : "The API returned matches but none matched the IPL filter. Check if the series ID in your environment is correct.",
        });
        setSyncing(false); return;
      }
      if (choices.length === 1) { await doSubmitSeedLink(choices[0].externalMatchId || ""); return; }
      setLinkChoices(choices); setPickedLinkId(choices[0].externalMatchId || "");
      setApiMsg({ type: "info", title: `${choices.length} IPL fixtures found`, detail: "Pick one below to link it." });
    } catch { showMsg("Network error loading matches.", "Load fixtures"); }
    setSyncing(false);
  }

  async function doFetchRoster() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Fetching player roster…" });
    try {
      const res = await fetch("/api/fetch-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matchId != null ? { matchId } : {}),
      });
      const json = await res.json(); addUsage(1);
      if (json.ok) {
        setApiMsg({ type: "success", title: `Roster loaded — ${json.playerCount} players. Refreshing…` });
        window.setTimeout(() => window.location.reload(), 900);
      } else {
        showMsg(json.error || "Could not load roster.", "Refresh Players");
      }
    } catch { showMsg("Network error loading roster.", "Refresh Players"); }
    setSyncing(false);
  }

  async function saveSide(side: "mine" | "theirs") {
    setSaving(side); setApiMsg(null);
    const payload =
      side === "mine"
        ? { saveSide: "mine", yourPlayers: mine, opponentName: rival, competitionId: competitionId ?? null }
        : { saveSide: "theirs", opponentPlayers: theirs, opponentName: rival, competitionId: competitionId ?? null };
    try {
      const res = await fetch("/api/lineup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const json = await res.json();
      setSaving(null);
      if (json.ok) {
        setApiMsg({ type: "success", title: `${side === "mine" ? yourName : rival}'s team saved! Taking you to the match…` });
        window.setTimeout(() => { window.location.href = "/match"; }, 900);
      } else {
        showMsg(json.error || "Could not save.", "Save team");
      }
    } catch { setSaving(null); showMsg("Network error saving lineup.", "Save team"); }
  }

  function updateCaptain(side: "mine" | "theirs", index: number) {
    (side === "mine" ? setMine : setTheirs)((prev) => prev.map((p, i) => ({ ...p, captain: i === index })));
  }
  function clearSlot(side: "mine" | "theirs", index: number) {
    (side === "mine" ? setMine : setTheirs)((prev) => prev.map((p, i) => i !== index ? p : { name: "", captain: false }));
  }
  function ensureOneCaptain(side: "mine" | "theirs") {
    (side === "mine" ? setMine : setTheirs)((prev) => {
      if (prev.some((p) => p.captain && p.name.trim())) return prev;
      const first = prev.findIndex((p) => p.name.trim());
      if (first === -1) return prev;
      return prev.map((p, i) => ({ ...p, captain: i === first }));
    });
  }
  function applyRosterName(name: string) {
    const list = activeSide === "mine" ? mine : theirs;
    const setter = activeSide === "mine" ? setMine : setTheirs;
    const next = list.findIndex((p) => !p.name.trim());
    if (next === -1) { setApiMsg({ type: "warning", title: "All 4 slots are full", detail: "Remove a player first, then tap again." }); return; }
    const providerId = nameToId[name.toLowerCase()] || undefined;
    setter((prev) => prev.map((p, i) => i === next ? { ...p, name, providerId } : p));
    setMessage("");
  }

  const YOU_COLOR = "#2563eb";
  const OPP_COLOR = "#dc2626";
  const sideColor = (side: "mine" | "theirs") => side === "mine" ? YOU_COLOR : OPP_COLOR;
  const sideBg   = (side: "mine" | "theirs") => side === "mine" ? "#eff6ff" : "#fef2f2";

  // Proactive banner: all keys are currently blocked
  const allBlocked = keyStats.length > 0 && keyStats.every((k) => k.blocked);
  const minResume = allBlocked
    ? keyStats.reduce((min, k) => {
        const m = k.resumesInMin ?? 999;
        return m < min ? m : min;
      }, 999)
    : null;

  // ── MULTI-PLAYER UI (3+ participants) ────────────────────────────────────
  if (isMulti) {
    const COLORS = ["#2563eb","#dc2626","#16a34a","#d97706","#7c3aed","#0891b2"];
    const activePicks = allPicks[activeMultiIdx] ?? [];
    const canSave = activePicks.every(p => p.name.trim()) && activePicks.filter(p => p.captain).length === 1;

    // Players taken by OTHER participants (not the active one) — these chips are locked
    const takenByOthers = new Set(
      allPicks.flatMap((picks, i) =>
        i === activeMultiIdx ? [] : picks.filter(p => p.name.trim()).map(p => p.name.toLowerCase())
      )
    );
    // Players already in the ACTIVE participant's own lineup (shown highlighted, re-tappable to no effect)
    const takenByActive = new Set(activePicks.filter(p => p.name.trim()).map(p => p.name.toLowerCase()));

    return (
      <div style={{ display: "grid", gap: 20 }}>
        {/* All-keys blocked banner */}
        {allBlocked && (
          <ApiMessage msg={{ type: "error", title: "All API keys are currently blocked", detail: "Rate-limited or quota exhausted. Wait before fetching rosters.", action: "View key usage", actionHref: "/api/key-stats" }} />
        )}
        {apiMsg && <ApiMessage msg={apiMsg} onDismiss={() => setApiMsg(null)} />}

        {/* Top bar — link match + save progress */}
        <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden" }}>
          <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <button onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit} style={btnDark}>{syncing ? "Loading…" : "Link IPL Match"}</button>
            {/* Save progress pills */}
            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              {multiPlayers.map((name, i) => (
                <span key={name} style={{
                  fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 999,
                  background: savedSet.has(i) ? "#dcfce7" : "#f1f5f9",
                  color: savedSet.has(i) ? "#15803d" : "#94a3b8",
                }}>
                  {savedSet.has(i) ? `✓ ${name}` : name}
                </span>
              ))}
            </div>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{apiUsed}/{QUOTA_LIMIT}</span>
            {/* Show scores button — available once any team is saved */}
            {savedSet.size > 0 && (
              <button
                onClick={() => window.location.reload()}
                style={{ padding: "7px 14px", borderRadius: 10, border: "1px solid #2563eb", background: "white", color: "#2563eb", cursor: "pointer", fontWeight: 700, fontSize: 13 }}
              >
                {savedSet.size >= multiPlayers.length ? "✓ View match scores →" : `View scores (${multiPlayers.length - savedSet.size} pending) →`}
              </button>
            )}
          </div>
        </div>

        {/* Match picker */}
        {linkChoices && linkChoices.length > 1 && (
          <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 18, padding: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 14 }}>Choose a match</div>
            <div style={{ display: "grid", gap: 10 }}>
              {linkChoices.map((c) => {
                const picked = pickedLinkId === c.externalMatchId;
                return (
                  <label key={c.externalMatchId || c.fixture} style={{ display: "flex", gap: 14, alignItems: "center", padding: "14px 16px", borderRadius: 14, cursor: "pointer", border: picked ? "2px solid #2563eb" : "1px solid #e2e8f0", background: picked ? "#eff6ff" : "white" }}>
                    <input type="radio" name="lp" checked={picked} onChange={() => setPickedLinkId(c.externalMatchId || "")} style={{ accentColor: "#2563eb" }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{formatFixture(c.fixture) || c.fixture}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{c.status}{c.venue ? ` · ${c.venue}` : ""}{c.match_date ? ` · ${c.match_date}` : ""}</div>
                    </div>
                    {picked && <span style={{ fontSize: 18 }}>✓</span>}
                  </label>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button style={btnDark} onClick={() => void (guardedRun(1, () => doSubmitSeedLink(pickedLinkId)))} disabled={syncing || !pickedLinkId}>{syncing ? "Linking…" : "Link selected"}</button>
              <button style={btnOutline} onClick={() => { setLinkChoices(null); setApiMsg(null); }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Two-column: roster left, active participant card right */}
        <div className="select-two-col" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) min(340px,100%)", gap: 20, alignItems: "start" }}>
          {/* Roster panel */}
          <div style={panel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Match Players</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{hasRoster ? "Tap to add to the active participant" : "Load the full squad roster"}</div>
              </div>
              {hasRoster && <button type="button" onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing} style={btnSm}>{syncing ? "…" : "↺ Refresh roster"}</button>}
            </div>
            {/* Active participant switcher */}
            {hasRoster && (
              <div style={{ display: "flex", gap: 0, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", marginBottom: 14, flexWrap: "wrap" }}>
                {multiPlayers.map((name, i) => (
                  <button key={name} type="button" onClick={() => setActiveMultiIdx(i)} style={{ flex: "1 1 auto", padding: "8px 12px", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 12, transition: "all 0.12s", background: activeMultiIdx === i ? COLORS[i % COLORS.length] : "white", color: activeMultiIdx === i ? "white" : "#64748b" }}>
                    + {name}
                  </button>
                ))}
              </div>
            )}
            {!hasLinkedMatch ? (
              <div style={{ textAlign: "center", padding: "32px 16px" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>🏏</div>
                <div style={{ fontWeight: 700, marginBottom: 16 }}>No match linked</div>
                <button style={btnDark} onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit}>Link IPL Match</button>
              </div>
            ) : !hasRoster ? (
              <div style={{ textAlign: "center", padding: "32px 16px" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📋</div>
                <div style={{ fontWeight: 700, marginBottom: 16 }}>Roster not loaded</div>
                <button style={btnDark} onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing}>{syncing ? "Loading…" : "Load Roster"}</button>
              </div>
            ) : squads.length > 0 ? (
              <div
                className="roster-teams-side-by-side"
                style={{
                  display: "grid",
                  gap: 16,
                  alignItems: "start",
                  gridTemplateColumns: squads.length === 1 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
                }}
              >
                {squads.map(team => (
                  <div key={team.teamName} style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#334155", marginBottom: 10, borderBottom: "1px solid #f1f5f9", paddingBottom: 6 }}>{team.teamName}</div>
                    <div style={rosterPlayersBelowTeam}>
                      {sortRosterByFirstName(team.players).map((name, i) => {
                        const takenOther = takenByOthers.has(name.toLowerCase());
                        const takenSelf = takenByActive.has(name.toLowerCase());
                        return (
                          <button
                            key={name}
                            type="button"
                            disabled={takenOther}
                            onClick={() => applyMultiRoster(name)}
                            style={{
                              display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 500,
                              cursor: takenOther ? "not-allowed" : "pointer",
                              border: takenSelf ? "2px solid #2563eb" : takenOther ? "1px solid #fecaca" : "1px solid #cbd5e1",
                              background: takenSelf ? "#eff6ff" : takenOther ? "#fff1f2" : "white",
                              color: takenOther ? "#fca5a5" : "#0f172a",
                              textDecoration: takenOther ? "line-through" : "none",
                              opacity: takenOther ? 0.6 : 1,
                            }}
                          >
                            <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: takenSelf ? "#2563eb" : "#e2e8f0", color: takenSelf ? "white" : "#64748b", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}{takenOther ? " (taken)" : ""}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={rosterPlayerGrid2}>
                {sortRosterByFirstName(rosterNames).map((name, i) => {
                  const takenOther = takenByOthers.has(name.toLowerCase());
                  const takenSelf = takenByActive.has(name.toLowerCase());
                  return (
                    <button
                      key={name}
                      type="button"
                      disabled={takenOther}
                      onClick={() => applyMultiRoster(name)}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, textAlign: "left", padding: "8px 10px", borderRadius: 10, fontSize: 12, fontWeight: 500,
                        cursor: takenOther ? "not-allowed" : "pointer",
                        border: takenSelf ? "2px solid #2563eb" : takenOther ? "1px solid #fecaca" : "1px solid #cbd5e1",
                        background: takenSelf ? "#eff6ff" : takenOther ? "#fff1f2" : "white",
                        color: takenOther ? "#fca5a5" : "#0f172a",
                        opacity: takenOther ? 0.6 : 1,
                      }}
                    >
                      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: takenSelf ? "#2563eb" : "#e2e8f0", color: takenSelf ? "white" : "#64748b", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active participant card */}
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#64748b", padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10 }}>
              💡 Each person picks their own 4. Use the tabs above to switch who you&apos;re picking for.
            </div>
            {multiPlayers.map((name, idx) => {
              const picks = allPicks[idx] ?? [];
              const filled = picks.filter(p => p.name.trim()).length;
              const canS = picks.every(p => p.name.trim()) && picks.filter(p => p.captain).length === 1;
              const color = COLORS[idx % COLORS.length];
              const isActive = activeMultiIdx === idx;
              return (
                <div key={name} style={{ ...panel, border: isActive ? `2px solid ${color}` : "1px solid #e2e8f0", opacity: isActive ? 1 : 0.7 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
                      <span style={{ fontWeight: 800, fontSize: 14 }}>{name}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{filled}/4</span>
                    </div>
                    {!isActive && <button type="button" onClick={() => setActiveMultiIdx(idx)} style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 8, border: `1px solid ${color}`, background: "white", color, cursor: "pointer" }}>Select</button>}
                    {isActive && <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}20`, padding: "3px 8px", borderRadius: 999 }}>Active ✓</span>}
                  </div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {picks.map((player, slotIdx) => (
                      <div key={slotIdx} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10, background: player.name.trim() ? (player.captain ? "#fefce8" : "#f8fafc") : "#f8fafc", border: player.name.trim() ? (player.captain ? "1px solid #fde68a" : "1px solid #e2e8f0") : "1px dashed #cbd5e1" }}>
                        <div style={{ width: 22, height: 22, borderRadius: 999, background: player.name.trim() ? color : "#e2e8f0", color: player.name.trim() ? "white" : "#94a3b8", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{slotIdx + 1}</div>
                        {player.name.trim() ? (
                          <>
                            <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{player.name}</span>
                            <button type="button" onClick={() => updateMultiCaptain(idx, slotIdx)} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 7, cursor: "pointer", border: player.captain ? "1px solid #d97706" : "1px solid #e2e8f0", background: player.captain ? "#fef9c3" : "white", color: player.captain ? "#d97706" : "#94a3b8", fontWeight: 700 }}>★</button>
                            <button type="button" onClick={() => clearMultiSlot(idx, slotIdx)} style={{ width: 22, height: 22, borderRadius: 999, border: "1px solid #fecaca", background: "#fff1f2", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✕</button>
                          </>
                        ) : (
                          <span style={{ flex: 1, color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>{isActive ? "← tap roster" : "empty"}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => void saveParticipant(idx)}
                    disabled={!canS || savingIdx !== null}
                    style={{
                      width: "100%", padding: "10px", borderRadius: 10, border: "none",
                      fontWeight: 700, fontSize: 13, cursor: canS && savingIdx === null ? "pointer" : "not-allowed",
                      background: savedSet.has(idx) ? "#dcfce7" : canS ? color : "#e2e8f0",
                      color: savedSet.has(idx) ? "#15803d" : canS ? "white" : "#94a3b8",
                    }}
                  >
                    {savingIdx === idx ? "Saving…"
                      : savedSet.has(idx) ? `✓ ${name}'s team saved — click to update`
                      : canS ? `Save ${name}'s team →`
                      : `Pick ${4 - filled} more`}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>

      {/* ── All keys blocked banner ────────────────────────────────────────── */}
      {allBlocked && (
        <ApiMessage
          msg={{
            type: "error",
            title: "All API keys are currently blocked",
            detail: minResume && minResume < 900
              ? `Some keys are in a 15-min rate-limit window, earliest resumes in ~${minResume} min. Others may have hit the daily 100-hit cap (resets next provider day; times in Eastern). Any API action will fail until at least one key is available.`
              : "All keys have hit their daily 100-hit limit until the next reset (UTC day; times shown in Eastern). You can still manually enter player scores using the ✏️ Edit button on each player.",
            action: "View key usage",
            actionHref: "/api/key-stats",
          }}
        />
      )}

      {/* ── Quota warning ─────────────────────────────────────────────────── */}
      {pendingAction && (
        <div style={warnStyle}>
          <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚠️ Low on API credits</div>
          <div style={{ color: "#78350f", fontSize: 14, marginBottom: 12 }}>
            {remaining} credit{remaining === 1 ? "" : "s"} left. This action uses {pendingAction.cost}. Continue?
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnDark} onClick={() => { const a = pendingAction; setPendingAction(null); void a.fn(); }}>Yes, proceed</button>
            <button style={btnOutline} onClick={() => setPendingAction(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Match control bar ─────────────────────────────────────────────── */}
      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 18, overflow: "hidden" }}>
        <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <button onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit} style={btnDark}>
          {syncing ? "Loading…" : "Link IPL Match"}
        </button>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: "auto", flexWrap: "wrap" }}>
          <span style={{
            fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999,
            background: isAtLimit ? "#fee2e2" : isNearLimit ? "#fef9c3" : "#f1f5f9",
            color: isAtLimit ? "#b91c1c" : isNearLimit ? "#92400e" : "#64748b",
          }}>{apiUsed}/{QUOTA_LIMIT} credits</span>
          {/* Reset blocks button — shown when any key appears blocked */}
          {keyStats.some((k) => k.blocked) && (
            <button
              type="button"
              disabled={resettingBlocks}
              title="Clear rate-limit blocks so all keys are retried"
              onClick={async () => {
                setResettingBlocks(true);
                try {
                  const r = await fetch("/api/reset-key-blocks", { method: "POST" });
                  const j = await r.json();
                  setApiMsg({ type: j.ok ? "success" : "error", title: j.message || j.error || "Done" });
                  refreshKeyStats();
                } catch { setApiMsg({ type: "error", title: "Could not reset blocks" }); }
                setResettingBlocks(false);
              }}
              style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 999, border: "1px solid #fca5a5", background: "#fff1f2", color: "#be123c", cursor: "pointer" }}
            >
              {resettingBlocks ? "…" : "↺ Clear blocks"}
            </button>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            {keyStats.map((k, i) => {
              const pct = k.hits / KEY_LIMIT;
              const blocked = k.blocked;
              const isQuotaDone = k.blockReason === "quota_exhausted" && !k.staleQuotaFlag;
              const isRateLimited = blocked && !isQuotaDone;
              const barColor = isQuotaDone ? "#ef4444" : isRateLimited ? "#f59e0b" : pct >= 0.8 ? "#f59e0b" : "#22c55e";
              const tip = isQuotaDone
                ? `K${i + 1}: daily quota reached (${k.hits}/100) — resets next UTC day (Eastern shown in UI)`
                : isRateLimited
                ? `K${i + 1}: rate-limited${k.resumesInMin ? ` — ~${k.resumesInMin} min remaining` : " — ~15 min"}`
                : `K${i + 1}: ${k.hits}/100 hits today — available`;
              return (
                <div key={k.alias} title={tip} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, opacity: blocked ? 0.55 : 1 }}>
                  <span style={{ fontSize: 10, color: blocked ? barColor : "#94a3b8", fontWeight: 600 }}>K{i + 1}</span>
                  <div style={{ width: 6, height: 32, borderRadius: 4, background: "#e2e8f0", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${Math.min(100, pct * 100)}%`, background: barColor, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>{k.hits}</span>
                  {isQuotaDone && <span style={{ fontSize: 9, color: barColor, fontWeight: 700 }}>✕</span>}
                  {isRateLimited && <span style={{ fontSize: 9, color: barColor, fontWeight: 700 }}>⏸</span>}
                </div>
              );
            })}
          </div>
        </div>
        </div>
        {/* Message row — always full-width, below the buttons */}
        {(apiMsg || message) && !linkChoices && (
          <div style={{ padding: "0 16px 14px" }}>
            {apiMsg
              ? <ApiMessage msg={apiMsg} onDismiss={() => setApiMsg(null)} />
              : <ApiMessage msg={classifyApiMsg(message)} onDismiss={() => setMessage("")} />
            }
          </div>
        )}
      </div>

      {/* ── Match picker ──────────────────────────────────────────────────── */}
      {linkChoices && linkChoices.length > 1 && (
        <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 18, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Choose a match</div>
          {linkDateHint && <div style={{ color: "#64748b", fontSize: 13, marginBottom: 14 }}>Showing ±1 day (Eastern) · {linkDateHint}</div>}
          <div style={{ display: "grid", gap: 10 }}>
            {linkChoices.map((c) => {
              const picked = pickedLinkId === c.externalMatchId;
              return (
                <label key={c.externalMatchId || c.fixture} style={{
                  display: "flex", gap: 14, alignItems: "center", padding: "14px 16px",
                  borderRadius: 14, cursor: "pointer",
                  border: picked ? "2px solid #2563eb" : "1px solid #e2e8f0",
                  background: picked ? "#eff6ff" : "white",
                  transition: "all 0.12s",
                }}>
                  <input type="radio" name="lp" checked={picked} onChange={() => setPickedLinkId(c.externalMatchId || "")} style={{ accentColor: "#2563eb" }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{formatFixture(c.fixture) || c.fixture}</div>
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                      {c.status}{c.venue ? ` · ${c.venue}` : ""}{c.match_date ? ` · ${c.match_date}` : ""}
                    </div>
                  </div>
                  {picked && <span style={{ fontSize: 18 }}>✓</span>}
                </label>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button style={btnDark} onClick={() => void (guardedRun(1, () => doSubmitSeedLink(pickedLinkId)))} disabled={syncing || !pickedLinkId}>
              {syncing ? "Linking…" : "Link selected match"}
            </button>
            <button style={btnOutline} onClick={() => { setLinkChoices(null); setMessage(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Main two-column layout ─────────────────────────────────────────── */}
        <div className="select-two-col" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) min(340px,100%)", gap: 20, alignItems: "start" }}>

        {/* LEFT — Player roster ─────────────────────────────────────────── */}
        <div style={panel}>
          {/* Panel header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Match Players</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                {hasRoster
                  ? "Tap a name to add to the selected team"
                  : hasLinkedMatch ? "Load the full squad roster from the API" : "Link a match first"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {hasRoster && (
                <button type="button" onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing} style={btnSm}>
                  {syncing ? "…" : "↺ Refresh roster"}
                </button>
              )}
              {!hasLinkedMatch && (
                <button type="button" onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit} style={btnSm}>
                  Link Match
                </button>
              )}
            </div>
          </div>

          {/* Active side switcher */}
          {hasRoster && (
            <div style={{ display: "flex", gap: 0, borderRadius: 12, overflow: "hidden", border: "1px solid #e2e8f0", marginBottom: 16, width: "fit-content" }}>
              {(["mine", "theirs"] as const).map((s) => (
                <button key={s} type="button" onClick={() => setActiveSide(s)} style={{
                  padding: "8px 18px", border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13, transition: "all 0.12s",
                  background: activeSide === s ? sideColor(s) : "white",
                  color: activeSide === s ? "white" : "#64748b",
                }}>
                  {s === "mine" ? `+ ${yourName}` : `+ ${rival}`}
                </button>
              ))}
            </div>
          )}

          {/* Roster content */}
          {!hasLinkedMatch ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🏏</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: "#0f172a" }}>No match linked</div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Link an IPL match to see the players.</div>
              <button style={btnDark} onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit}>
                Link IPL Match
              </button>
            </div>
          ) : !hasRoster ? (
            <div style={{ textAlign: "center", padding: "40px 20px" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: "#0f172a" }}>Roster not loaded yet</div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 20 }}>Usually available a few hours before the match starts.</div>
              <button style={btnDark} onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing}>
                {syncing ? "Loading…" : "Load Player Roster"}
              </button>
            </div>
          ) : (
            <>
              {squads.length > 0 ? (
                <div
                  className="roster-teams-side-by-side"
                  style={{
                    display: "grid",
                    gap: 16,
                    alignItems: "start",
                    gridTemplateColumns: squads.length === 1 ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))",
                  }}
                >
                  {squads.map((team) => (
                    <div key={team.teamName} style={{ minWidth: 0 }}>
                      {/* Team label */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
                        paddingBottom: 8, borderBottom: "1px solid #f1f5f9", flexWrap: "wrap",
                      }}>
                        <div style={{ width: 3, height: 18, borderRadius: 2, background: "#0f172a", flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", letterSpacing: 0.2 }}>{team.teamName}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{team.players.length} players</span>
                      </div>
                      <div style={rosterPlayersBelowTeam}>
                        {sortRosterByFirstName(team.players).map((name, i) => {
                          const taken = takenNames.has(name.trim().toLowerCase());
                          const isTarget = activeSide === "mine"
                            ? mine.some((p) => p.name === name)
                            : theirs.some((p) => p.name === name);
                          const ac = sideColor(activeSide);
                          const ab = sideBg(activeSide);
                          return (
                            <button
                              key={`${team.teamName}-${name}`}
                              type="button"
                              disabled={taken}
                              onClick={() => applyRosterName(name)}
                              style={{
                                display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                                padding: "9px 12px", borderRadius: 12, fontSize: 13, fontWeight: 500,
                                cursor: taken ? "not-allowed" : "pointer",
                                border: isTarget
                                  ? `2px solid ${ac}`
                                  : taken ? "1px solid #e2e8f0" : "1px solid #cbd5e1",
                                background: isTarget ? ab : taken ? "#f8fafc" : "white",
                                color: taken ? "#94a3b8" : "#0f172a",
                                textDecoration: taken && !isTarget ? "line-through" : "none",
                                opacity: taken && !isTarget ? 0.55 : 1,
                                transition: "all 0.1s",
                              }}
                            >
                              <span style={{
                                flexShrink: 0, width: 26, height: 26, borderRadius: 999,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                background: isTarget ? ac : taken ? "#e2e8f0" : "#f1f5f9",
                                color: isTarget ? "white" : "#64748b",
                                fontSize: 12, fontWeight: 700,
                              }}>{i + 1}</span>
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={rosterPlayerGrid2}>
                  {sortRosterByFirstName(rosterNames).map((name, i) => {
                    const taken = takenNames.has(name.trim().toLowerCase());
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={taken}
                        onClick={() => applyRosterName(name)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                          padding: "9px 12px", borderRadius: 12, fontSize: 13, fontWeight: 500,
                          cursor: taken ? "not-allowed" : "pointer",
                          border: taken ? "1px solid #e2e8f0" : "1px solid #cbd5e1",
                          background: taken ? "#f8fafc" : "white",
                          color: taken ? "#94a3b8" : "#0f172a",
                          textDecoration: taken ? "line-through" : "none",
                          opacity: taken ? 0.55 : 1,
                        }}
                      >
                        <span style={{
                          flexShrink: 0, width: 26, height: 26, borderRadius: 999,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: taken ? "#e2e8f0" : "#f1f5f9",
                          color: "#64748b", fontSize: 12, fontWeight: 700,
                        }}>{i + 1}</span>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT — Team lineup cards ────────────────────────────────────── */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* Tip */}
          <div style={{ fontSize: 12, color: "#64748b", padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10 }}>
            💡 <strong>Independent saves</strong> — {yourName} and {rival} each save their own 4.
          </div>

          {(["mine", "theirs"] as const).map((side) => {
            const list = side === "mine" ? mine : theirs;
            const name = side === "mine" ? yourName : rival;
            const canSave = side === "mine" ? canSaveMine : canSaveTheirs;
            const isSaving = saving === side;
            const isActive = activeSide === side;
            const color = sideColor(side);
            const bg = sideBg(side);
            const filled = list.filter((p) => p.name.trim()).length;

            return (
              <div
                key={side}
                style={{
                  ...panel,
                  border: isActive ? `2px solid ${color}` : "1px solid #e2e8f0",
                  transition: "border 0.15s",
                }}
              >
                {/* Card header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 999, background: color, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: "#0f172a" }}>{name}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
                        {filled}/4 picked · 1 captain
                      </div>
                    </div>
                  </div>
                  {!isActive && (
                    <button type="button" onClick={() => setActiveSide(side)} style={{
                      fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 8,
                      border: `1px solid ${color}`, background: "white", color, cursor: "pointer",
                    }}>
                      Select here
                    </button>
                  )}
                  {isActive && (
                    <span style={{ fontSize: 12, fontWeight: 700, color, background: bg, padding: "4px 10px", borderRadius: 999 }}>
                      Active ✓
                    </span>
                  )}
                </div>

                {/* Opponent name field */}
                {side === "theirs" && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.05, display: "block", marginBottom: 5 }}>
                      Opponent name
                    </label>
                    <input value={rival} onChange={(e) => setRival(e.target.value)} style={inputStyle} placeholder="e.g. Rahul" />
                  </div>
                )}

                {/* Player slots */}
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {list.map((player, index) => {
                    const filled = Boolean(player.name.trim());
                    return (
                      <div
                        key={index}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", borderRadius: 12,
                          background: filled ? (player.captain ? "#fefce8" : "#f8fafc") : "#f8fafc",
                          border: filled
                            ? player.captain ? "1px solid #fde68a" : "1px solid #e2e8f0"
                            : "1px dashed #cbd5e1",
                          minHeight: 48,
                        }}
                      >
                        {/* Slot number */}
                        <div style={{
                          width: 26, height: 26, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                          background: filled ? color : "#e2e8f0", color: filled ? "white" : "#94a3b8",
                          fontSize: 12, fontWeight: 700,
                        }}>
                          {index + 1}
                        </div>

                        {filled ? (
                          <>
                            <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{player.name}</span>
                            {/* Captain toggle */}
                            <button
                              type="button"
                              onClick={() => updateCaptain(side, index)}
                              title="Set as captain (×2 pts)"
                              style={{
                                fontSize: 13, padding: "3px 8px", borderRadius: 8, cursor: "pointer",
                                fontWeight: 700, transition: "all 0.12s",
                                border: player.captain ? "1px solid #d97706" : "1px solid #e2e8f0",
                                background: player.captain ? "#fef9c3" : "white",
                                color: player.captain ? "#d97706" : "#94a3b8",
                              }}
                            >
                              ★ {player.captain ? "Captain" : "Cap?"}
                            </button>
                            {/* Remove */}
                            <button
                              type="button"
                              onClick={() => { clearSlot(side, index); ensureOneCaptain(side); }}
                              style={{ width: 26, height: 26, borderRadius: 999, border: "1px solid #fecaca", background: "#fff1f2", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 700, flexShrink: 0 }}
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <span style={{ flex: 1, color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
                            {isActive ? "← tap a player" : "empty"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Save button */}
                <button
                  onClick={() => void saveSide(side)}
                  disabled={!canSave || saving !== null}
                  style={{
                    width: "100%", padding: "12px", borderRadius: 12, border: "none",
                    fontWeight: 700, fontSize: 14, cursor: canSave ? "pointer" : "not-allowed",
                    background: canSave ? color : "#e2e8f0",
                    color: canSave ? "white" : "#94a3b8",
                    transition: "all 0.15s",
                  }}
                >
                  {isSaving ? "Saving…" : canSave ? `Save ${name}'s team →` : `Pick ${4 - list.filter(p => p.name.trim()).length} more player${4 - list.filter(p => p.name.trim()).length === 1 ? "" : "s"}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* select-two-col responsive handled in globals.css */}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const panel: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 20,
  padding: 22,
  boxShadow: "var(--shadow-card)",
};
const btnDark: CSSProperties = {
  padding: "11px 20px",
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
  boxShadow: "0 2px 14px rgba(37,99,235,0.32)",
};
const btnOutline: CSSProperties = {
  padding: "11px 20px",
  borderRadius: 14,
  border: "1px solid var(--border-strong)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
  boxShadow: "var(--shadow-xs)",
};
const btnSm: CSSProperties = { padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", color: "#0f172a", cursor: "pointer", fontWeight: 600, fontSize: 13 };
const inputStyle: CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 10, boxSizing: "border-box", fontSize: 14, outline: "none" };
const warnStyle: CSSProperties = { border: "2px solid #fcd34d", borderRadius: 16, background: "#fffbeb", padding: 16 };

// Legacy aliases so any other file importing these still works
export const panelStyle = panel;
export const chipGrid: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
export const chip: CSSProperties = { padding: "7px 14px", borderRadius: 999, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", cursor: "pointer", fontSize: 13, fontWeight: 500 };
export const chipTaken: CSSProperties = { ...chip, background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "not-allowed", opacity: 0.55, textDecoration: "line-through" };
