"use client";

import React, { useEffect, useMemo, useState, useCallback, type CSSProperties } from "react";
import { formatFixture } from "@/lib/format";

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

type Player = { name: string; captain: boolean };
type SquadTeam = { teamName: string; players: string[] };
type MatchChoice = { externalMatchId?: string; fixture: string; status: string; venue?: string | null; match_date: string };

type Props = {
  opponentName: string;
  yourPlayers: Player[];
  opponentPlayers: Player[];
  rosterNames: string[];
  squads: SquadTeam[];
  hasLinkedMatch: boolean;
};

function emptyPlayers() { return Array.from({ length: 4 }, () => ({ name: "", captain: false })); }
function withFallback(players: Player[]) {
  const next = emptyPlayers();
  for (let i = 0; i < Math.min(players.length, 4); i++) next[i] = players[i];
  if (!next.some((p) => p.captain) && next[0]) next[0].captain = true;
  return next;
}

export default function SelectClient({ opponentName, yourPlayers, opponentPlayers, rosterNames, squads, hasLinkedMatch }: Props) {
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
  const [apiUsed, setApiUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number } | null>(null);
  const [keyStats, setKeyStats] = useState<{ alias: string; hits: number }[]>([]);

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

  const canSave = useMemo(() => {
    return mine.every((p) => p.name.trim()) && theirs.every((p) => p.name.trim()) &&
      mine.filter((p) => p.captain).length === 1 && theirs.filter((p) => p.captain).length === 1;
  }, [mine, theirs]);

  const hasRoster = rosterNames.length > 0 || squads.some((t) => t.players.length > 0);

  function guardedRun(cost: number, fn: () => Promise<void>) {
    if (isAtLimit) { setMessage(`API quota reached. Resets at midnight IST.`); return; }
    if (isNearLimit) { setPendingAction({ fn, cost }); return; }
    void fn();
  }

  async function doSubmitSeedLink(externalMatchId: string) {
    if (!externalMatchId) { setMessage("Pick a match first."); return; }
    setSyncing(true); setMessage("Linking match…");
    try {
      const res = await fetch("/api/seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ externalMatchId }) });
      const json = await res.json();
      setLinkChoices(null); addUsage(1);
      setMessage(json.ok ? "Match linked! Refreshing…" : json.error || "Could not link match.");
      if (json.ok) window.location.reload();
    } catch { setMessage("Network error while linking."); }
    setSyncing(false);
  }

  async function doStartLinkTodaysMatch() {
    setSyncing(true); setMessage("Loading IPL fixtures…"); setLinkChoices(null);
    try {
      const res = await fetch("/api/matches/today");
      const json = await res.json();
      addUsage(2);
      if (!json.ok) { setMessage(json.error || "Could not load matches."); setSyncing(false); return; }
      setLinkDateHint(typeof json.date === "string" ? json.date : "");
      const choices: MatchChoice[] = Array.isArray(json.choices) ? json.choices : [];
      if (choices.length === 0) {
        const totalRaw = json.totalRaw ?? 0;
        setMessage(totalRaw === 0
          ? "API returned 0 matches — rate-limited or quota used up. Wait 15 min and retry."
          : `${totalRaw} matches in feed but none are IPL yet.`);
        setSyncing(false); return;
      }
      if (choices.length === 1) { await doSubmitSeedLink(choices[0].externalMatchId || ""); return; }
      setLinkChoices(choices); setPickedLinkId(choices[0].externalMatchId || "");
      setMessage(`${choices.length} IPL fixtures found — pick one.`);
    } catch { setMessage("Network error loading matches."); }
    setSyncing(false);
  }

  async function doFetchRoster() {
    setSyncing(true); setMessage("Fetching player roster…");
    try {
      const res = await fetch("/api/fetch-roster", { method: "POST" });
      const json = await res.json(); addUsage(1);
      if (json.ok) { setMessage(`Roster loaded (${json.playerCount} players). Refreshing…`); window.setTimeout(() => window.location.reload(), 800); }
      else setMessage(json.error || "Could not load roster.");
    } catch { setMessage("Network error loading roster."); }
    setSyncing(false);
  }

  async function saveLineup() {
    setSaving(true); setMessage("Saving lineup…");
    try {
      const res = await fetch("/api/lineup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opponentName: rival, yourPlayers: mine, opponentPlayers: theirs }) });
      const json = await res.json(); setSaving(false);
      if (json.ok) { setMessage("Saved! Heading to match…"); window.setTimeout(() => { window.location.href = "/match"; }, 600); }
      else setMessage(json.error || "Could not save lineup.");
    } catch { setSaving(false); setMessage("Network error saving lineup."); }
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
    if (next === -1) { setMessage(`All 4 slots are full. Remove a player first.`); return; }
    setter((prev) => prev.map((p, i) => i === next ? { ...p, name } : p));
    setMessage("");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>

      {/* Quota warning dialog */}
      {pendingAction && (
        <div style={warnStyle}>
          <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚠️ Low on API credits</div>
          <div style={{ color: "#78350f", fontSize: 14, marginBottom: 12 }}>
            {remaining} credit{remaining === 1 ? "" : "s"} left. This uses {pendingAction.cost}. Proceed?
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={btnPrimary} onClick={() => { const a = pendingAction; setPendingAction(null); void a.fn(); }}>Yes, proceed</button>
            <button style={btnSecondary} onClick={() => setPendingAction(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Link match row */}
      <div style={barStyle}>
        <button onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit} style={btnPrimary}>
          {syncing ? "⏳ Loading…" : "Link IPL Match"}
        </button>
        {message && !linkChoices && <span style={{ fontSize: 13, color: "#475569", flex: 1 }}>{message}</span>}
        {/* Quota mini display */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginLeft: "auto" }}>
          <span style={{ fontSize: 12, color: isAtLimit ? "#b91c1c" : isNearLimit ? "#92400e" : "#94a3b8" }}>
            {apiUsed}/{QUOTA_LIMIT} credits
          </span>
          {keyStats.map((k, i) => {
            const pct = k.hits / KEY_LIMIT;
            const c = pct >= 1 ? "#ef4444" : pct >= 0.8 ? "#f59e0b" : "#22c55e";
            return (
              <span key={k.alias} style={{ fontSize: 11, color: "#64748b", display: "flex", alignItems: "center", gap: 4 }}>
                K{i + 1} <span style={{ display: "inline-block", width: 28, height: 4, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.min(100, pct * 100)}%`, background: c }} />
                </span> {k.hits}
              </span>
            );
          })}
        </div>
      </div>

      {/* Match picker */}
      {linkChoices && linkChoices.length > 1 && (
        <div style={pickerStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose an IPL match to import</div>
          {linkDateHint && <div style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>Showing ±1 day (IST) · {linkDateHint}</div>}
          <div style={{ display: "grid", gap: 8 }}>
            {linkChoices.map((c) => (
              <label key={c.externalMatchId || c.fixture} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 12, border: pickedLinkId === c.externalMatchId ? "2px solid #2563eb" : "1px solid #e2e8f0", background: pickedLinkId === c.externalMatchId ? "#eff6ff" : "white", cursor: "pointer" }}>
                <input type="radio" name="lp" checked={pickedLinkId === c.externalMatchId} onChange={() => setPickedLinkId(c.externalMatchId || "")} style={{ marginTop: 3 }} />
                <div>
                  <div style={{ fontWeight: 600 }}>{formatFixture(c.fixture) || c.fixture}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{c.status}{c.venue ? ` · ${c.venue}` : ""}{c.match_date ? ` · ${c.match_date}` : ""}</div>
                </div>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button style={btnPrimary} onClick={() => void (guardedRun(1, () => doSubmitSeedLink(pickedLinkId)))} disabled={syncing || !pickedLinkId}>{syncing ? "Working…" : "Link selected match"}</button>
            <button style={btnSecondary} onClick={() => { setLinkChoices(null); setMessage(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Roster panel */}
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Players in this match</h3>
          {hasRoster && (
            <div style={{ display: "flex", borderRadius: 10, overflow: "hidden", border: "1px solid #e2e8f0" }}>
              <button type="button" onClick={() => setActiveSide("mine")} style={tabStyle(activeSide === "mine")}>+ Your Team</button>
              <button type="button" onClick={() => setActiveSide("theirs")} style={tabStyle(activeSide === "theirs")}>+ {rival || "Opponent"}&apos;s Team</button>
            </div>
          )}
        </div>

        {!hasLinkedMatch ? (
          <div style={{ color: "#64748b", fontSize: 14 }}>Use &quot;Link IPL Match&quot; above to import a fixture first.</div>
        ) : !hasRoster ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ color: "#64748b", fontSize: 14 }}>No roster loaded yet. Usually available a few hours before match.</div>
            <button style={btnPrimary} onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing}>{syncing ? "Loading…" : "Load Player Roster"}</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>Tap a player to add to the active side. Greyed = already picked.</div>
            {squads.length > 0 ? (
              <div style={{ display: "grid", gap: 16 }}>
                {squads.map((team) => (
                  <div key={team.teamName}>
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13, color: "#334155" }}>{team.teamName}</div>
                    <div style={chipGrid}>
                      {team.players.map((name) => {
                        const taken = takenNames.has(name.trim().toLowerCase());
                        return <button key={`${team.teamName}-${name}`} type="button" style={taken ? chipTaken : chip} disabled={taken} onClick={() => applyRosterName(name)}>{name}</button>;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={chipGrid}>
                {rosterNames.map((name) => {
                  const taken = takenNames.has(name.trim().toLowerCase());
                  return <button key={name} type="button" style={taken ? chipTaken : chip} disabled={taken} onClick={() => applyRosterName(name)}>{name}</button>;
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Lineup panel */}
      <div style={panelStyle}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>Lineups</h3>
        <div style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>Pick 4 players each · mark 1 as ★ Team Captain (points ×2)</div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, color: "#475569", display: "block", marginBottom: 4 }}>Opponent name</label>
          <input value={rival} onChange={(e) => setRival(e.target.value)} style={inputStyle} placeholder="Opponent name" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
          {(["mine", "theirs"] as const).map((side) => {
            const list = side === "mine" ? mine : theirs;
            const label = side === "mine" ? "Your 4 players" : `${rival || "Opponent"}'s 4 players`;
            return (
              <div key={side}>
                <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 14 }}>{label}</div>
                {list.map((player, index) => (
                  <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, minHeight: 40 }}>
                    <div style={slotNum}>{index + 1}</div>
                    {player.name.trim() ? (
                      <>
                        <span style={{ flex: 1, fontWeight: 500, fontSize: 14 }}>{player.name}</span>
                        <label style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                          <input type="radio" name={`${side}-cap`} checked={player.captain} onChange={() => updateCaptain(side, index)} />
                          <span style={{ color: player.captain ? "#d97706" : "#94a3b8" }}>★ Captain</span>
                        </label>
                        <button style={clearBtn} onClick={() => { clearSlot(side, index); ensureOneCaptain(side); }}>✕</button>
                      </>
                    ) : (
                      <span style={{ flex: 1, color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
                        {activeSide === side ? "← tap a player above" : "empty"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={saveLineup} disabled={!canSave || saving} style={btnPrimary}>
            {saving ? "Saving…" : "Save Lineups & Go to Match →"}
          </button>
          {message && linkChoices === null && <span style={{ fontSize: 13, color: "#475569" }}>{message}</span>}
        </div>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const panelStyle: CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 20, background: "white", padding: 20, boxShadow: "0 1px 2px rgba(0,0,0,0.05)" };
const barStyle: CSSProperties = { display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px", background: "white", border: "1px solid #e2e8f0", borderRadius: 16 };
const pickerStyle: CSSProperties = { border: "1px solid #bfdbfe", borderRadius: 20, background: "#f0f9ff", padding: 20 };
const warnStyle: CSSProperties = { border: "2px solid #fcd34d", borderRadius: 16, background: "#fffbeb", padding: 16 };
const btnPrimary: CSSProperties = { padding: "10px 16px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: CSSProperties = { ...btnPrimary, background: "white", color: "#0f172a" };
const inputStyle: CSSProperties = { width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 10, boxSizing: "border-box", fontSize: 14 };
const chipGrid: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
const chip: CSSProperties = { padding: "6px 12px", borderRadius: 999, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", cursor: "pointer", fontSize: 13, fontWeight: 500 };
const chipTaken: CSSProperties = { ...chip, background: "#f1f5f9", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "not-allowed", textDecoration: "line-through" };
const slotNum: CSSProperties = { width: 24, height: 24, borderRadius: 999, background: "#e2e8f0", color: "#64748b", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const clearBtn: CSSProperties = { padding: "3px 7px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 700 };
function tabStyle(active: boolean): CSSProperties { return { padding: "6px 14px", border: "none", background: active ? "#0f172a" : "white", color: active ? "white" : "#475569", cursor: "pointer", fontWeight: 600, fontSize: 13 }; }
