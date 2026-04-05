"use client";

import React, { useState, useEffect, useCallback, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { formatFixture } from "@/lib/format";
import { formatUiCalendarDate, formatUiDateTime } from "@/lib/ui-time";
import PlayerTable from "@/components/PlayerTable";
import ManualScorePanel from "@/components/ManualScorePanel";
import SelectClient from "@/components/SelectClient";
import { FantasyPlayer, teamPoints } from "@/lib/scoring";
import ApiMessage from "@/components/ApiMessage";
import AuditTrailPanel from "@/components/AuditTrailPanel";
import { classifyApiMsg, type ApiMsg } from "@/lib/api-message";
import { navigateToMatchAfterSeed } from "@/lib/post-seed-nav-client";

const QUOTA_LIMIT = 1100; // 100/day × 11 API keys (CRICKET_API_KEY … _11)
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

type MatchChoice = { externalMatchId?: string; fixture: string; status: string; venue?: string | null; match_date: string };
type CurrentMatch = { fixture?: string; label?: string; status?: string; venue?: string | null; toss_winner?: string | null; live_summary?: string | null; last_synced_at?: string | null };

type DebugData = {
  message?: string; skipped?: boolean; reason?: string; live_summary?: string; error?: string;
  debug?: {
    selectedCount?: number;
    providerRowCount?: number;
    updatedRows?: number;
    unmatched?: string[];
    matched?: Array<{ selected: string; provider: string; matchedById?: boolean }>;
    providerPlayersSample?: string[];
    syncedAt?: string;
    lastSyncedAt?: string;
    sourceUrl?: string | null;
    status?: string;
    rosterCount?: number;
  };
};

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
};

function DebugPanel({ info }: { info: DebugData | null }) {
  const [open, setOpen] = useState(false);

  if (!info) return null;
  const d = info.debug;
  return (
    <div style={{ marginTop: 20, border: "1px solid #dbeafe", borderRadius: 14, background: "#f8fbff", padding: "10px 14px" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 600, color: "#64748b", padding: 0 }}>
        {open ? "▾" : "▸"} Sync debug
      </button>
      {open && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#334155" }}>
          <div style={{ marginBottom: 4 }}>{info.error || info.reason || info.message || "—"}</div>
          {info.live_summary && <div><strong>Live:</strong> {info.live_summary}</div>}
          {typeof d?.updatedRows === "number" && <div><strong>Updated:</strong> {d.updatedRows}/{d.selectedCount ?? 0} players</div>}
          {d?.matched && d.matched.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Matched:</strong>{" "}
              <span style={{ wordBreak: "break-word" }}>
                {d.matched.slice(0, 24).map((m) => `${m.selected} → ${m.provider}${m.matchedById ? " (id)" : ""}`).join(" · ")}
                {d.matched.length > 24 ? ` … +${d.matched.length - 24} more` : ""}
              </span>
            </div>
          )}
          {d?.unmatched?.length ? <div style={{ marginTop: 6 }}><strong>Unmatched:</strong> {d.unmatched.join(", ")}</div> : null}
          {d?.providerPlayersSample?.length ? <div><strong>Provider names:</strong> {d.providerPlayersSample.join(", ")}</div> : null}
          {(d?.syncedAt || d?.lastSyncedAt) && (
            <div>
              <strong>Synced at:</strong> {formatUiDateTime(String(d.syncedAt || d.lastSyncedAt))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MatchClient({ yourName, opponentName, yourFantasyPlayers, opponentFantasyPlayers, matchId, currentMatch, hasLinkedMatch, yourLineupSaved, opponentLineupSaved, rosterNames, squads, nameToId, existingYourPlayers, existingOppPlayers, competitionId, allParticipants }: Props) {
  const router = useRouter();
  const isMultiPlayer = (allParticipants?.length ?? 0) > 2;
  // Show inline team picker only when NO ONE has saved yet (truly fresh start).
  // Once any participant has saved, show the live view — the pending banner
  // guides remaining participants to pick via "Pick teams →".
  const nobodyHasSaved = isMultiPlayer
    ? (allParticipants ?? []).length === 0 || (allParticipants ?? []).every(p => p.players.length === 0)
    : !yourLineupSaved && !opponentLineupSaved;
  const needsSetup = nobodyHasSaved && hasLinkedMatch;
  const [teamPickerOpen, setTeamPickerOpen] = useState(needsSetup);
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

  /** Per-participant totals for 3+ player comps — do not use opponentFantasyPlayers (that merges everyone except player 1). */
  const multiScoreboard =
    isMultiPlayer && allParticipants && allParticipants.length > 0
      ? allParticipants
          .map((p) => ({ name: p.name, players: p.players, total: teamPoints(p.players) }))
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
    if (isAtLimit) { setApiMsg(classifyApiMsg("Daily API quota exhausted", "Quota")); return; }
    if (isNearLimit) { setPendingAction({ fn, cost }); return; }
    void fn();
  }

  async function doRefreshNow() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Syncing scores…" });
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matchId != null ? { matchId } : {}),
      });
      const json = await res.json();
      setSyncing(false); setDebugInfo(json);

      if (json.skipped) {
        // Cached response — show as info, no reload needed
        setApiMsg({ type: "info", title: json.reason || "Already up to date", detail: "Scores were synced very recently. The displayed values are current." });
        return;
      }

      if (!json.ok) {
        const errorText = json.error || "Refresh failed";
        const classified = classifyApiMsg(errorText, "Sync scores");
        setApiMsg(classified);
        // Auto-open manual editor when API is blocked so users can still enter scores
        if (classified.type === "warning" || classified.type === "error") {
          const blocked = /rate.?limit|block|quota|exhausted/i.test(errorText);
          if (blocked && (yourFantasyPlayers.length > 0 || opponentFantasyPlayers.length > 0)) {
            setShowManual(true);
          }
        }
        return;
      }

      addUsage(1);
      const successMsg: ApiMsg = { type: "success", title: json.message || "Scores updated!" };
      setApiMsg(successMsg);
      // Soft refresh keeps this panel and messages visible (full reload used to wipe debug before you could read it).
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
      setLinkChoices(null); addUsage(1);
      showMsg(json.ok ? "Match linked! Opening…" : (json.error || "Could not link match."), "Link match");
      if (json.ok) {
        const mid = json.match && typeof json.match.id === "number" ? json.match.id : null;
        if (mid != null) navigateToMatchAfterSeed(mid);
        else window.location.reload();
      }
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
    ? formatUiDateTime(currentMatch.last_synced_at)
    : "Not yet";

  // ── Inline team picker (no lineup yet, or "Change Team" requested) ─────────
  if (teamPickerOpen) {
    return (
      <div style={{ display: "grid", gap: 20 }}>
        {/* Header strip */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", background: "white", border: "1px solid #e2e8f0", borderRadius: 14, flexWrap: "wrap", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a" }}>
              {needsSetup ? "Set up your teams" : "Change teams"}
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
              {fixtureName !== "No match linked" ? fixtureName : "Link a match first"}
            </div>
          </div>
          {!needsSetup && (
            <button
              onClick={() => setTeamPickerOpen(false)}
              style={{ ...btnSecondary, padding: "7px 14px", fontSize: 13 }}
            >
              ✕ Cancel
            </button>
          )}
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
          matchId={matchId ?? null}
          competitionId={competitionId ?? null}
          compPlayers={isMultiPlayer ? (allParticipants ?? []).map(p => p.name) : undefined}
          existingPicks={isMultiPlayer ? (allParticipants ?? []).map(p => p.players.map(fp => ({
            name: fp.name,
            captain: fp.captain,
            bench: fp.bench,
            provider_player_id: fp.provider_player_id ?? null,
          }))) : undefined}
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
        <button onClick={() => setTeamPickerOpen(true)} style={{ ...btnPrimary, border: "none", cursor: "pointer" }}>
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
      {pendingPickers.length > 0 && (
        <div style={{ padding: "12px 16px", borderRadius: 14, background: "#fffbeb", border: "1px solid #fde68a", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontSize: 14, color: "#92400e" }}>
            ⏳ <strong>{pendingPickers.join(", ")}</strong> {pendingPickers.length === 1 ? "hasn't" : "haven't"} picked {pendingPickers.length === 1 ? "their" : "their"} team yet — scores will show as 0.
          </div>
          <button
            type="button"
            onClick={() => setTeamPickerOpen(true)}
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
            onClick={() => setTeamPickerOpen(true)}
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
          <button onClick={() => guardedRun(1, doRefreshNow)} disabled={syncing || isAtLimit} style={{ ...btnPrimary, flex: "1 1 auto", textAlign: "center" as const }}>
            {syncing ? "Syncing…" : "⟳ Sync Scores"}
          </button>
          <button onClick={() => guardedRun(2, doStartLinkMatch)} disabled={syncing || isAtLimit} style={{ ...btnSecondary, flex: "1 1 auto", textAlign: "center" as const }}>
            {syncing ? "Loading…" : "Link Match"}
          </button>
          <div style={{ width: "100%", display: "flex", justifyContent: "space-between", fontSize: 11, color: "#94a3b8", padding: "0 2px" }}>
            <span>Last synced: {lastSynced}</span>
            <span style={{ color: isAtLimit ? "#b91c1c" : "#94a3b8" }}>{apiUsed}/{QUOTA_LIMIT} credits</span>
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
          {linkDateHint && <div style={{ color: "#64748b", fontSize: 13, marginBottom: 10 }}>Showing ±1 day (Eastern) · {linkDateHint}</div>}
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
              No scores yet. Each participant saves their lineup first, then click <strong>Sync Scores</strong>.
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

      <DebugPanel info={debugInfo} />
      <AuditTrailPanel matchId={matchId} competitionId={competitionId} />
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
