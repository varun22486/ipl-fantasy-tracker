"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { formatFixture } from "@/lib/format";
import type { CSSProperties } from "react";
import ApiMessage from "@/components/ApiMessage";
import { classifyApiMsg, type ApiMsg } from "@/lib/api-message";

const KEY_LIMIT = 100;
const QUOTA_LIMIT = 300;
const QUOTA_WARN_AT = 240;
const QUOTA_KEY = "cricapi_quota";

function getIstDateStr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function loadQuota(): number {
  try {
    const raw = localStorage.getItem(QUOTA_KEY);
    if (!raw) return 0;
    const { count, date } = JSON.parse(raw) as { count: number; date: string };
    return date === getIstDateStr() ? (count ?? 0) : 0;
  } catch { return 0; }
}
function saveQuota(count: number) {
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify({ count, date: getIstDateStr() })); } catch {}
}

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
};

function emptyPlayers() { return Array.from({ length: 4 }, () => ({ name: "", captain: false })); }
function withFallback(players: Player[]) {
  const next = emptyPlayers();
  for (let i = 0; i < Math.min(players.length, 4); i++) next[i] = players[i];
  if (!next.some((p) => p.captain) && next[0]) next[0].captain = true;
  return next;
}

export default function SelectClient({ yourName, opponentName, yourPlayers, opponentPlayers, rosterNames, squads, nameToId, hasLinkedMatch }: Props) {
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
    alias: string; hits: number; blocked?: boolean; blockReason?: string | null; resumesInMin?: number | null;
  }[]>([]);

  useEffect(() => {
    setApiUsed(loadQuota());
    fetch("/api/key-stats").then((r) => r.json()).then((j) => { if (j.ok && Array.isArray(j.stats)) setKeyStats(j.stats); }).catch(() => {});
  }, []);

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
        showMsg(`${json.totalRaw ?? 0} matches in feed but none are IPL yet.`, "Load fixtures");
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
      const res = await fetch("/api/fetch-roster", { method: "POST" });
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
        ? { saveSide: "mine", yourPlayers: mine, opponentName: rival }
        : { saveSide: "theirs", opponentPlayers: theirs, opponentName: rival };
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

  return (
    <div style={{ display: "grid", gap: 20 }}>

      {/* ── All keys blocked banner ────────────────────────────────────────── */}
      {allBlocked && (
        <ApiMessage
          msg={{
            type: "error",
            title: "All API keys are currently blocked",
            detail: minResume && minResume < 900
              ? `Some keys are in a 15-min rate-limit window, earliest resumes in ~${minResume} min. Others may have hit the daily 100-hit cap (resets at midnight). Any API action will fail until at least one key is available.`
              : "All keys have hit their daily 100-hit limit and won't reset until midnight. You can still manually enter player scores using the ✏️ Edit button on each player.",
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
          <div style={{ display: "flex", gap: 6 }}>
            {keyStats.map((k, i) => {
              const pct = k.hits / KEY_LIMIT;
              const blocked = k.blocked;
              const isQuotaDone = k.blockReason === "quota_exhausted";
              const c = blocked
                ? (isQuotaDone ? "#ef4444" : "#f59e0b")
                : pct >= 0.8 ? "#f59e0b" : "#22c55e";
              const tip = blocked
                ? isQuotaDone
                  ? `K${i + 1}: daily quota exhausted — resets at midnight`
                  : `K${i + 1}: rate-limited${k.resumesInMin ? ` — ~${k.resumesInMin} min` : ""}`
                : `K${i + 1}: ${k.hits}/100 hits today`;
              return (
                <div key={k.alias} title={tip} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, opacity: blocked ? 0.5 : 1 }}>
                  <span style={{ fontSize: 10, color: blocked ? c : "#94a3b8", fontWeight: 600 }}>K{i + 1}</span>
                  <div style={{ width: 6, height: 32, borderRadius: 4, background: "#e2e8f0", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${Math.min(100, pct * 100)}%`, background: c, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 10, color: "#94a3b8" }}>{k.hits}</span>
                  {blocked && <span style={{ fontSize: 9, color: c, fontWeight: 700 }}>{isQuotaDone ? "✕" : "⏸"}</span>}
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
          {linkDateHint && <div style={{ color: "#64748b", fontSize: 13, marginBottom: 14 }}>Showing ±1 day (IST) · {linkDateHint}</div>}
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
        <div className="select-two-col" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 20, alignItems: "start" }}>

        {/* LEFT — Player roster ─────────────────────────────────────────── */}
        <div style={panel}>
          {/* Panel header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: "#0f172a" }}>Match Players</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                {hasRoster
                  ? "Tap a name to add to the selected team"
                  : hasLinkedMatch ? "Fetch the playing XI once the teams are announced" : "Link a match first"}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {hasRoster && (
                <button type="button" onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing} style={btnSm}>
                  {syncing ? "…" : "↺ Refresh XI"}
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
                <div style={{ display: "grid", gap: 20 }}>
                  {squads.map((team) => (
                    <div key={team.teamName}>
                      {/* Team label */}
                      <div style={{
                        display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
                        paddingBottom: 8, borderBottom: "1px solid #f1f5f9",
                      }}>
                        <div style={{ width: 3, height: 18, borderRadius: 2, background: "#0f172a" }} />
                        <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", letterSpacing: 0.2 }}>{team.teamName}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{team.players.length} players</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {team.players.map((name) => {
                          const taken = takenNames.has(name.trim().toLowerCase());
                          const isTarget = activeSide === "mine"
                            ? mine.some((p) => p.name === name)
                            : theirs.some((p) => p.name === name);
                          return (
                            <button
                              key={`${team.teamName}-${name}`}
                              type="button"
                              disabled={taken}
                              onClick={() => applyRosterName(name)}
                              style={{
                                padding: "7px 14px",
                                borderRadius: 999,
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: taken ? "not-allowed" : "pointer",
                                border: isTarget
                                  ? `2px solid ${sideColor(activeSide)}`
                                  : taken ? "1px solid #e2e8f0" : "1px solid #cbd5e1",
                                background: isTarget
                                  ? sideBg(activeSide)
                                  : taken ? "#f8fafc" : "white",
                                color: taken ? "#94a3b8" : "#0f172a",
                                textDecoration: taken && !isTarget ? "line-through" : "none",
                                opacity: taken && !isTarget ? 0.55 : 1,
                                transition: "all 0.1s",
                              }}
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {rosterNames.map((name) => {
                    const taken = takenNames.has(name.trim().toLowerCase());
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={taken}
                        onClick={() => applyRosterName(name)}
                        style={{
                          padding: "7px 14px", borderRadius: 999, fontSize: 13, fontWeight: 500,
                          cursor: taken ? "not-allowed" : "pointer",
                          border: taken ? "1px solid #e2e8f0" : "1px solid #cbd5e1",
                          background: taken ? "#f8fafc" : "white",
                          color: taken ? "#94a3b8" : "#0f172a",
                          textDecoration: taken ? "line-through" : "none",
                          opacity: taken ? 0.55 : 1,
                        }}
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

      {/* ── Responsive override for narrow screens ───────────────────────── */}
      <style>{`
        @media (max-width: 760px) {
          .select-two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const panel: CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 20, padding: 20, boxShadow: "0 1px 3px rgba(15,23,42,0.06)" };
const btnDark: CSSProperties = { padding: "10px 18px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", cursor: "pointer", fontWeight: 700, fontSize: 14 };
const btnOutline: CSSProperties = { ...btnDark, background: "white", color: "#0f172a" };
const btnSm: CSSProperties = { padding: "7px 14px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", color: "#0f172a", cursor: "pointer", fontWeight: 600, fontSize: 13 };
const inputStyle: CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 10, boxSizing: "border-box", fontSize: 14, outline: "none" };
const warnStyle: CSSProperties = { border: "2px solid #fcd34d", borderRadius: 16, background: "#fffbeb", padding: 16 };

// Legacy aliases so any other file importing these still works
export const panelStyle = panel;
export const chipGrid: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
export const chip: CSSProperties = { padding: "7px 14px", borderRadius: 999, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", cursor: "pointer", fontSize: 13, fontWeight: 500 };
export const chipTaken: CSSProperties = { ...chip, background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "not-allowed", opacity: 0.55, textDecoration: "line-through" };
