"use client";

import React, { useState, useEffect, useCallback, type CSSProperties } from "react";
import { formatFixture } from "@/lib/format";
import PlayerTable from "@/components/PlayerTable";
import { FantasyPlayer, teamPoints } from "@/lib/scoring";
import ApiMessage from "@/components/ApiMessage";
import { classifyApiMsg, type ApiMsg } from "@/lib/api-message";

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

type MatchChoice = { externalMatchId?: string; fixture: string; status: string; venue?: string | null; match_date: string };
type CurrentMatch = { fixture?: string; label?: string; status?: string; venue?: string | null; toss_winner?: string | null; live_summary?: string | null; last_synced_at?: string | null };

type DebugData = {
  message?: string; skipped?: boolean; reason?: string; live_summary?: string; error?: string;
  debug?: { selectedCount?: number; providerRowCount?: number; updatedRows?: number; unmatched?: string[]; matched?: Array<{ selected: string; provider: string }>; providerPlayersSample?: string[]; syncedAt?: string; lastSyncedAt?: string; sourceUrl?: string | null; status?: string; rosterCount?: number };
};

type Props = {
  yourName: string;
  opponentName: string;
  yourFantasyPlayers: FantasyPlayer[];
  opponentFantasyPlayers: FantasyPlayer[];
  currentMatch: CurrentMatch | null;
  hasLinkedMatch: boolean;
  yourLineupSaved: boolean;
  opponentLineupSaved: boolean;
};

function DebugPanel({ info }: { info: DebugData | null }) {
  const [open, setOpen] = useState(false);
  if (!info) return null;
  const d = info.debug;
  return (
    <div style={{ border: "1px solid #dbeafe", borderRadius: 14, background: "#f8fbff", padding: "10px 14px" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 600, color: "#64748b", padding: 0 }}>
        {open ? "▾" : "▸"} Sync debug
      </button>
      {open && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#334155" }}>
          <div style={{ marginBottom: 4 }}>{info.error || info.reason || info.message || "—"}</div>
          {info.live_summary && <div><strong>Live:</strong> {info.live_summary}</div>}
          {typeof d?.updatedRows === "number" && <div><strong>Updated:</strong> {d.updatedRows}/{d.selectedCount ?? 0} players</div>}
          {d?.unmatched?.length ? <div><strong>Unmatched:</strong> {d.unmatched.join(", ")}</div> : null}
          {d?.providerPlayersSample?.length ? <div><strong>Provider names:</strong> {d.providerPlayersSample.join(", ")}</div> : null}
          {(d?.syncedAt || d?.lastSyncedAt) && <div><strong>Synced at:</strong> {d.syncedAt || d.lastSyncedAt}</div>}
        </div>
      )}
    </div>
  );
}

export default function MatchClient({ yourName, opponentName, yourFantasyPlayers, opponentFantasyPlayers, currentMatch, hasLinkedMatch, yourLineupSaved, opponentLineupSaved }: Props) {
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [apiMsg, setApiMsg] = useState<ApiMsg | null>(() => {
    // Restore any message that was saved before a page reload
    try {
      const saved = typeof sessionStorage !== "undefined" ? sessionStorage.getItem("match_msg") : null;
      if (saved) { sessionStorage.removeItem("match_msg"); return JSON.parse(saved) as ApiMsg; }
    } catch {}
    return null;
  });
  const [debugInfo, setDebugInfo] = useState<DebugData | null>(null);
  const [apiUsed, setApiUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number } | null>(null);
  const [linkChoices, setLinkChoices] = useState<MatchChoice[] | null>(null);
  const [pickedLinkId, setPickedLinkId] = useState("");
  const [linkDateHint, setLinkDateHint] = useState("");

  useEffect(() => { setApiUsed(loadQuota()); }, []);

  const addUsage = useCallback((n: number) => {
    setApiUsed((prev) => { const next = prev + n; saveQuota(next); return next; });
  }, []);

  const remaining = QUOTA_LIMIT - apiUsed;
  const isNearLimit = apiUsed >= QUOTA_WARN_AT;
  const isAtLimit = remaining <= 0;

  const yourTotal = teamPoints(yourFantasyPlayers);
  const oppTotal = teamPoints(opponentFantasyPlayers);
  const leader = yourTotal === oppTotal ? "Tied" : yourTotal > oppTotal ? `You +${yourTotal - oppTotal}` : `${opponentName} +${oppTotal - yourTotal}`;

  const showMsg = useCallback((text: string, context?: string) => {
    setApiMsg(classifyApiMsg(text, context));
    setMessage("");
  }, []);

  function guardedRun(cost: number, fn: () => Promise<void>) {
    if (isAtLimit) { setApiMsg(classifyApiMsg("Daily API quota exhausted", "Quota")); return; }
    if (isNearLimit) { setPendingAction({ fn, cost }); return; }
    void fn();
  }

  async function doRefreshNow() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Syncing scores…" });
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const json = await res.json();
      setSyncing(false); setDebugInfo(json);

      if (json.skipped) {
        // Cached response — show as info, no reload needed
        setApiMsg({ type: "info", title: json.reason || "Already up to date", detail: "Scores were synced very recently. The displayed values are current." });
        return;
      }

      if (!json.ok) {
        const errorText = json.error || "Refresh failed";
        setApiMsg(classifyApiMsg(errorText, "Sync scores"));
        return;
      }

      addUsage(1);
      // Success — persist the message through the upcoming page reload
      const successMsg: ApiMsg = { type: "success", title: json.message || "Scores updated!" };
      try { sessionStorage.setItem("match_msg", JSON.stringify(successMsg)); } catch {}
      setApiMsg(successMsg);
      window.setTimeout(() => window.location.reload(), 2500);
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
      setLinkChoices(null); addUsage(1);
      showMsg(json.ok ? "Match linked! Reloading…" : (json.error || "Could not link match."), "Link match");
      if (json.ok) window.location.reload();
    } catch { showMsg("Network error while linking.", "Link match"); }
    setSyncing(false);
  }

  async function doStartLinkMatch() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Loading IPL fixtures…" });
    setLinkChoices(null);
    try {
      const res = await fetch("/api/matches/today");
      const json = await res.json(); addUsage(2);
      if (!json.ok) { showMsg(json.error || "Could not load matches.", "Load fixtures"); setSyncing(false); return; }
      setLinkDateHint(typeof json.date === "string" ? json.date : "");
      const choices: MatchChoice[] = Array.isArray(json.choices) ? json.choices : [];
      if (choices.length === 0) { showMsg(`${json.totalRaw ?? 0} matches in feed but none are IPL.`, "Load fixtures"); setSyncing(false); return; }
      if (choices.length === 1) { await doSubmitSeedLink(choices[0].externalMatchId || ""); return; }
      setLinkChoices(choices); setPickedLinkId(choices[0].externalMatchId || "");
      setApiMsg({ type: "info", title: `${choices.length} fixtures found`, detail: "Pick one below to link it." });
    } catch { showMsg("Network error loading matches.", "Load fixtures"); }
    setSyncing(false);
  }

  const fixtureName = formatFixture(currentMatch?.fixture) || currentMatch?.fixture || "No match linked";
  const lastSynced = currentMatch?.last_synced_at
    ? new Date(currentMatch.last_synced_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : "Not yet";

  if (!hasLinkedMatch) {
    return (
      <div style={{ textAlign: "center", padding: 60, border: "1px solid #e2e8f0", borderRadius: 20, background: "white" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏏</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>No match linked yet</div>
        <div style={{ color: "#64748b", marginBottom: 20 }}>Go to Select Teams to link an IPL match and set your lineup.</div>
        <a href="/select" style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>👥 Select Teams →</a>
      </div>
    );
  }

  const missingLineups = [
    !yourLineupSaved && yourName,
    !opponentLineupSaved && opponentName,
  ].filter(Boolean) as string[];

  return (
    <div style={{ display: "grid", gap: 20 }}>

      {/* Missing lineup warning */}
      {hasLinkedMatch && missingLineups.length > 0 && (
        <div style={{ padding: "12px 16px", borderRadius: 14, background: "#fff7ed", border: "1px solid #fed7aa", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 14, color: "#92400e" }}>
            ⚠️ <strong>{missingLineups.join(" & ")}</strong> {missingLineups.length === 1 ? "hasn't" : "haven't"} saved {missingLineups.length === 1 ? "their" : "their"} team yet — scores will show as 0.
          </div>
          <a href="/select" style={{ padding: "6px 14px", borderRadius: 8, background: "#0f172a", color: "white", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
            → Select Teams
          </a>
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
        <div style={{ textAlign: "right" }}>
          <span style={{ padding: "4px 12px", borderRadius: 999, background: currentMatch?.status === "LIVE" ? "#dcfce7" : "#f1f5f9", color: currentMatch?.status === "LIVE" ? "#16a34a" : "#64748b", fontSize: 13, fontWeight: 600 }}>
            {currentMatch?.status ?? "—"}
          </span>
        </div>
      </div>

      {/* Score cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 14 }}>
        {[
        { label: `${yourName}'s Points`, value: yourTotal, color: "#1d4ed8" },
        { label: `${opponentName}'s Points`, value: oppTotal, color: "#dc2626" },
        { label: "Leader", value: leader, color: "#0f172a" },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "white", padding: "14px 18px" }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Sync bar */}
      <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "12px 16px" }}>
          <button onClick={() => guardedRun(1, doRefreshNow)} disabled={syncing || isAtLimit} style={btnPrimary}>
            {syncing ? "Syncing…" : "⟳ Sync Scores Now"}
          </button>
          <button onClick={() => guardedRun(2, doStartLinkMatch)} disabled={syncing || isAtLimit} style={btnSecondary}>
            {syncing ? "Loading…" : "Link Different Match"}
          </button>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Last synced: {lastSynced}</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: isAtLimit ? "#b91c1c" : "#94a3b8" }}>{apiUsed}/{QUOTA_LIMIT} credits</span>
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

      {/* Match picker */}
      {linkChoices && linkChoices.length > 1 && (
        <div style={{ border: "1px solid #bfdbfe", borderRadius: 16, background: "#f0f9ff", padding: 18 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Choose an IPL match to import</div>
          {linkDateHint && <div style={{ color: "#64748b", fontSize: 13, marginBottom: 10 }}>Showing ±1 day (IST) · {linkDateHint}</div>}
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
            <button style={btnSecondary} onClick={() => { setLinkChoices(null); setMessage(""); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Player tables */}
      {yourFantasyPlayers.length > 0 || opponentFantasyPlayers.length > 0 ? (
        <div style={{ display: "grid", gap: 16 }}>
          <PlayerTable title={`${yourName}'s Team`} players={yourFantasyPlayers} />
          <PlayerTable title={`${opponentName}'s Team`} players={opponentFantasyPlayers} />
        </div>
      ) : (
        <div style={{ textAlign: "center", padding: 32, border: "1px solid #e2e8f0", borderRadius: 16, background: "white", color: "#64748b" }}>
          No scores yet. Save your lineup first, then click <strong>Sync Scores Now</strong>.
          <br /><br />
          <a href="/select" style={{ ...btnPrimary, textDecoration: "none", display: "inline-block" }}>👥 Select Teams</a>
        </div>
      )}

      <DebugPanel info={debugInfo} />
    </div>
  );
}

const btnPrimary: CSSProperties = { padding: "9px 15px", borderRadius: 10, border: "1px solid #0f172a", background: "#0f172a", color: "white", cursor: "pointer", fontWeight: 600, fontSize: 14 };
const btnSecondary: CSSProperties = { ...btnPrimary, background: "white", color: "#0f172a" };
