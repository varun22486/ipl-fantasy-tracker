"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { formatFixture } from "@/lib/format";
import { formatUiCalendarDate } from "@/lib/ui-time";
import type { CSSProperties } from "react";
import ApiMessage from "@/components/ApiMessage";
import { classifyApiMsg, type ApiMsg } from "@/lib/api-message";
import { navigateToMatchAfterSeed } from "@/lib/post-seed-nav-client";
import {
  emptyRosterSlots,
  ROSTER_MAX_PLAYERS,
  ROSTER_STARTING_COUNT,
  rosterFilledCount,
  rosterSlotsCanSave,
  rosterSlotsFromSaved,
  rosterStartersFilled,
  slotsToLineupPayload,
  type RosterSlotPlayer,
} from "@/lib/roster-config";

const KEY_LIMIT = 100;
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

/** Stable key so roster labels match stored lineup names (trim, case, Unicode NFC). */
function rosterNameKey(n: string): string {
  const t = n.trim().toLowerCase();
  try {
    return t.normalize("NFC");
  } catch {
    return t;
  }
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

type Player = RosterSlotPlayer;
type SquadTeam = { teamName: string; players: string[] };
type MatchChoice = { externalMatchId?: string; fixture: string; status: string; venue?: string | null; match_date: string };

type Props = {
  yourName: string;
  opponentName: string;
  yourPlayers: Array<{ name: string; captain: boolean; bench?: boolean | null; provider_player_id?: string | null }>;
  opponentPlayers: Array<{ name: string; captain: boolean; bench?: boolean | null; provider_player_id?: string | null }>;
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
  existingPicks?: Array<Array<{ name: string; captain: boolean; bench?: boolean | null; provider_player_id?: string | null }>>;
  /** When set (e.g. history detail editor), navigate here after save instead of /match?m=… */
  afterLineupSaveHref?: string | null;
};

export default function SelectClient({ yourName, opponentName, yourPlayers, opponentPlayers, rosterNames, squads, nameToId, hasLinkedMatch, matchId, competitionId, compPlayers, existingPicks, afterLineupSaveHref }: Props) {
  // Multi-player mode: 3+ participants
  const isMulti = (compPlayers?.length ?? 0) >= 3;
  const multiPlayers = compPlayers ?? [];
  // Per-participant picks array (mirrors compPlayers indices)
  const [allPicks, setAllPicks] = React.useState<Player[][]>(() =>
    multiPlayers.map((_, i) =>
      (existingPicks?.[i]?.length ? rosterSlotsFromSaved(existingPicks[i]!) : emptyRosterSlots())
    )
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

  type LineupFlash =
    | { kind: "h2h"; side: "mine" | "theirs"; slotIdx: number }
    | { kind: "multi"; participantIdx: number; slotIdx: number };
  const [lineupFlash, setLineupFlash] = useState<LineupFlash | null>(null);
  const lineupFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleLineupFlash = useCallback((payload: LineupFlash) => {
    if (lineupFlashTimerRef.current) clearTimeout(lineupFlashTimerRef.current);
    setLineupFlash(payload);
    lineupFlashTimerRef.current = setTimeout(() => {
      setLineupFlash(null);
      lineupFlashTimerRef.current = null;
    }, 750);
  }, []);

  useEffect(() => () => {
    if (lineupFlashTimerRef.current) clearTimeout(lineupFlashTimerRef.current);
  }, []);

  async function saveParticipant(idx: number) {
    const picks = allPicks[idx];
    const name = multiPlayers[idx];
    if (!rosterSlotsCanSave(picks)) return;
    setSavingIdx(idx); setApiMsg(null);
    try {
      const res = await fetch("/api/lineup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: name,
          players: slotsToLineupPayload(picks),
          competitionId: competitionId ?? null,
          ...(matchId != null ? { matchId } : {}),
        }),
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
    if (slotIdx >= ROSTER_STARTING_COUNT) return;
    setAllPicks((prev) =>
      prev.map((picks, i) => (i !== idx ? picks : picks.map((p, j) => ({ ...p, captain: j === slotIdx }))))
    );
  }
  function clearMultiSlot(idx: number, slotIdx: number) {
    setAllPicks((prev) =>
      prev.map((picks, i) => {
        if (i !== idx) return picks;
        const next = picks.map((p, j) => (j !== slotIdx ? p : { name: "", captain: false, providerId: undefined }));
        const head = next.slice(0, ROSTER_STARTING_COUNT);
        if (!head.some((p) => p.captain && p.name.trim())) {
          const first = head.findIndex((p) => p.name.trim());
          if (first !== -1) next[first] = { ...next[first], captain: true };
        }
        for (let j = ROSTER_STARTING_COUNT; j < ROSTER_MAX_PLAYERS; j++) next[j] = { ...next[j], captain: false };
        return next;
      })
    );
  }
  function applyMultiRoster(name: string) {
    const key = rosterNameKey(name);
    if (allPicks.some((row) => row.some((p) => p.name.trim() && rosterNameKey(p.name) === key))) {
      setApiMsg({
        type: "warning",
        title: "Already picked",
        detail: "Each player can only be on one lineup. Remove them from a slot first to move.",
      });
      return;
    }
    const picks = allPicks[activeMultiIdx];
    const next = picks.findIndex((p) => !p.name.trim());
    if (next === -1) {
      setApiMsg({ type: "warning", title: "All 7 slots full", detail: "Remove a player first." });
      return;
    }
    const providerId = nameToId[name.trim().toLowerCase()] || undefined;
    setAllPicks((prev) =>
      prev.map((p, i) =>
        i !== activeMultiIdx ? p : p.map((slot, j) => (j !== next ? slot : { ...slot, name, providerId }))
      )
    );
    scheduleLineupFlash({ kind: "multi", participantIdx: activeMultiIdx, slotIdx: next });
  }
  function moveMultiSlot(idx: number, from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= ROSTER_MAX_PLAYERS) return;
    setAllPicks((prev) =>
      prev.map((picks, i) => {
        if (i !== idx) return picks;
        const next = [...picks];
        [next[from], next[to]] = [next[to]!, next[from]!];
        for (let j = ROSTER_STARTING_COUNT; j < ROSTER_MAX_PLAYERS; j++) next[j] = { ...next[j], captain: false };
        const head = next.slice(0, ROSTER_STARTING_COUNT);
        if (!head.some((p) => p.captain && p.name.trim())) {
          const fi = head.findIndex((p) => p.name.trim());
          if (fi !== -1) next[fi] = { ...next[fi], captain: true };
        }
        return next;
      })
    );
  }
  const [saving, setSaving] = useState<"mine" | "theirs" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [apiMsg, setApiMsg] = useState<ApiMsg | null>(null);
  const [rival, setRival] = useState(opponentName || "Rahul");
  const [mine, setMine] = useState<Player[]>(() =>
    yourPlayers.length ? rosterSlotsFromSaved(yourPlayers) : emptyRosterSlots()
  );
  const [theirs, setTheirs] = useState<Player[]>(() =>
    opponentPlayers.length ? rosterSlotsFromSaved(opponentPlayers) : emptyRosterSlots()
  );
  /** Last successful server payload per side — current slots must match to count as “saved” for H2H navigation. */
  const [mineBaseline, setMineBaseline] = useState(() =>
    slotsToLineupPayload(yourPlayers.length ? rosterSlotsFromSaved(yourPlayers) : emptyRosterSlots())
  );
  const [theirsBaseline, setTheirsBaseline] = useState(() =>
    slotsToLineupPayload(opponentPlayers.length ? rosterSlotsFromSaved(opponentPlayers) : emptyRosterSlots())
  );
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
    for (const p of mine) if (p.name.trim()) s.add(rosterNameKey(p.name));
    for (const p of theirs) if (p.name.trim()) s.add(rosterNameKey(p.name));
    return s;
  }, [mine, theirs]);

  const canSaveMine = rosterSlotsCanSave(mine);
  const canSaveTheirs = rosterSlotsCanSave(theirs);

  const minePayload = useMemo(() => slotsToLineupPayload(mine), [mine]);
  const theirsPayload = useMemo(() => slotsToLineupPayload(theirs), [theirs]);
  const h2hMineSynced =
    rosterSlotsCanSave(mine) && JSON.stringify(minePayload) === JSON.stringify(mineBaseline);
  const h2hTheirSynced =
    rosterSlotsCanSave(theirs) && JSON.stringify(theirsPayload) === JSON.stringify(theirsBaseline);
  const h2hBothSynced = h2hMineSynced && h2hTheirSynced;
  const h2hMatchHref = useMemo(() => {
    const p = new URLSearchParams();
    if (competitionId != null) p.set("c", String(competitionId));
    if (matchId != null) p.set("m", String(matchId));
    return p.toString() ? `/match?${p.toString()}` : "/match";
  }, [competitionId, matchId]);

  /** Every name on any multi-participant lineup (for hiding from roster). */
  const allTakenKeysMulti = useMemo(() => {
    const s = new Set<string>();
    for (const row of allPicks) {
      for (const p of row) {
        if (p.name.trim()) s.add(rosterNameKey(p.name));
      }
    }
    return s;
  }, [allPicks]);

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
      showMsg(json.ok ? "Match linked! Opening…" : (json.error || "Could not link match."), "Link match");
      if (json.ok) {
        const mid = json.match && typeof json.match.id === "number" ? json.match.id : null;
        if (mid != null) navigateToMatchAfterSeed(mid);
        else window.location.reload();
      }
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
        ? { saveSide: "mine", yourPlayers: slotsToLineupPayload(mine), opponentName: rival, competitionId: competitionId ?? null }
        : { saveSide: "theirs", opponentPlayers: slotsToLineupPayload(theirs), opponentName: rival, competitionId: competitionId ?? null };
    const withMatch = matchId != null ? { ...payload, matchId } : payload;
    try {
      const res = await fetch("/api/lineup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(withMatch) });
      const json = await res.json();
      setSaving(null);
      if (json.ok) {
        const minePay = slotsToLineupPayload(mine);
        const theirsPay = slotsToLineupPayload(theirs);
        let nextMineBl = mineBaseline;
        let nextTheirsBl = theirsBaseline;
        if (side === "mine") {
          nextMineBl = minePay;
          setMineBaseline(minePay);
        } else {
          nextTheirsBl = theirsPay;
          setTheirsBaseline(theirsPay);
        }

        const params = new URLSearchParams();
        if (competitionId != null) params.set("c", String(competitionId));
        if (matchId != null) params.set("m", String(matchId));
        const matchDest = params.toString() ? `/match?${params.toString()}` : "/match";
        const dest = afterLineupSaveHref ?? matchDest;

        if (afterLineupSaveHref) {
          setApiMsg({
            type: "success",
            title: `${side === "mine" ? yourName : rival}'s team saved! Taking you back…`,
          });
          window.setTimeout(() => {
            window.location.href = dest;
          }, 900);
        } else {
          const bothSynced =
            rosterSlotsCanSave(mine) &&
            rosterSlotsCanSave(theirs) &&
            JSON.stringify(minePay) === JSON.stringify(nextMineBl) &&
            JSON.stringify(theirsPay) === JSON.stringify(nextTheirsBl);
          if (bothSynced) {
            setApiMsg({ type: "success", title: "Both teams saved! Opening the match…" });
            window.setTimeout(() => {
              window.location.href = matchDest;
            }, 900);
          } else {
            const other = side === "mine" ? rival : yourName;
            setApiMsg({
              type: "success",
              title: `${side === "mine" ? yourName : rival}'s team saved`,
              detail: `Save ${other}'s team here too — then you'll go to the match automatically.`,
            });
            setActiveSide(side === "mine" ? "theirs" : "mine");
          }
        }
      } else {
        showMsg(json.error || "Could not save.", "Save team");
      }
    } catch { setSaving(null); showMsg("Network error saving lineup.", "Save team"); }
  }

  function updateCaptain(side: "mine" | "theirs", index: number) {
    if (index >= ROSTER_STARTING_COUNT) return;
    (side === "mine" ? setMine : setTheirs)((prev) => prev.map((p, i) => ({ ...p, captain: i === index })));
  }
  function clearSlot(side: "mine" | "theirs", index: number) {
    (side === "mine" ? setMine : setTheirs)((prev) => {
      const next = prev.map((p, i) => (i !== index ? p : { name: "", captain: false, providerId: undefined }));
      const head = next.slice(0, ROSTER_STARTING_COUNT);
      if (!head.some((p) => p.captain && p.name.trim())) {
        const fi = head.findIndex((p) => p.name.trim());
        if (fi !== -1) next[fi] = { ...next[fi], captain: true };
      }
      for (let j = ROSTER_STARTING_COUNT; j < ROSTER_MAX_PLAYERS; j++) next[j] = { ...next[j], captain: false };
      return next;
    });
  }
  function ensureOneCaptain(side: "mine" | "theirs") {
    (side === "mine" ? setMine : setTheirs)((prev) => {
      const head = prev.slice(0, ROSTER_STARTING_COUNT);
      if (head.some((p) => p.captain && p.name.trim())) return prev;
      const first = head.findIndex((p) => p.name.trim());
      if (first === -1) return prev;
      return prev.map((p, i) => ({ ...p, captain: i === first }));
    });
  }
  function moveH2hSlot(side: "mine" | "theirs", from: number, dir: -1 | 1) {
    const to = from + dir;
    if (to < 0 || to >= ROSTER_MAX_PLAYERS) return;
    (side === "mine" ? setMine : setTheirs)((prev) => {
      const next = [...prev];
      [next[from], next[to]] = [next[to]!, next[from]!];
      for (let j = ROSTER_STARTING_COUNT; j < ROSTER_MAX_PLAYERS; j++) next[j] = { ...next[j], captain: false };
      const head = next.slice(0, ROSTER_STARTING_COUNT);
      if (!head.some((p) => p.captain && p.name.trim())) {
        const fi = head.findIndex((p) => p.name.trim());
        if (fi !== -1) next[fi] = { ...next[fi], captain: true };
      }
      return next;
    });
  }
  function applyRosterName(name: string) {
    const key = rosterNameKey(name);
    if (
      mine.some((p) => p.name.trim() && rosterNameKey(p.name) === key) ||
      theirs.some((p) => p.name.trim() && rosterNameKey(p.name) === key)
    ) {
      setApiMsg({
        type: "warning",
        title: "Already picked",
        detail: "Each player can only be on one lineup. Remove them from a slot first.",
      });
      return;
    }
    const list = activeSide === "mine" ? mine : theirs;
    const setter = activeSide === "mine" ? setMine : setTheirs;
    const next = list.findIndex((p) => !p.name.trim());
    if (next === -1) {
      setApiMsg({ type: "warning", title: "All 7 slots are full", detail: "Remove a player first, then tap again." });
      return;
    }
    const providerId = nameToId[name.trim().toLowerCase()] || undefined;
    setter((prev) => prev.map((p, i) => (i === next ? { ...p, name, providerId } : p)));
    scheduleLineupFlash({
      kind: "h2h",
      side: activeSide === "mine" ? "mine" : "theirs",
      slotIdx: next,
    });
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
    const canSave = rosterSlotsCanSave(activePicks);

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
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{hasRoster ? "Picked players leave this list; clear a slot to bring one back" : "Load the full squad roster"}</div>
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
                {squads.map(team => {
                  const avail = sortRosterByFirstName(team.players).filter((n) => !allTakenKeysMulti.has(rosterNameKey(n)));
                  return (
                  <div key={team.teamName} style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: "#334155", marginBottom: 10, borderBottom: "1px solid #f1f5f9", paddingBottom: 6 }}>
                      {team.teamName}
                      <span style={{ fontWeight: 600, color: "#94a3b8", marginLeft: 8 }}>{avail.length} available</span>
                    </div>
                    <div style={rosterPlayersBelowTeam}>
                      {avail.length === 0 ? (
                        <p className="select-roster-empty-hint">All players from this squad are on a lineup</p>
                      ) : (
                      avail.map((name, i) => (
                          <button
                            key={`${team.teamName}-${name}`}
                            type="button"
                            onClick={() => applyMultiRoster(name)}
                            className="select-roster-chip select-roster-chip--multi"
                          >
                            <span className="select-roster-chip__idx">{i + 1}</span>
                            <span className="select-roster-chip__name">{name}</span>
                          </button>
                      ))
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div style={rosterPlayerGrid2}>
                {(() => {
                  const avail = sortRosterByFirstName(rosterNames).filter((n) => !allTakenKeysMulti.has(rosterNameKey(n)));
                  if (avail.length === 0) {
                    return <p className="select-roster-empty-hint">Everyone is on a lineup — clear a slot to return someone here</p>;
                  }
                  return avail.map((name, i) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => applyMultiRoster(name)}
                      className="select-roster-chip select-roster-chip--multi"
                    >
                      <span className="select-roster-chip__idx">{i + 1}</span>
                      <span className="select-roster-chip__name">{name}</span>
                    </button>
                  ));
                })()}
              </div>
            )}
          </div>

          {/* Active participant card */}
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, color: "#64748b", padding: "8px 12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10 }}>
              💡 Each person picks 4 for points + up to 3 super subs. Use ↑↓ to swap slots. Tabs switch whose lineup you&apos;re editing.
            </div>
            {multiPlayers.map((name, idx) => {
              const picks = allPicks[idx] ?? [];
              const filled = rosterFilledCount(picks);
              const canS = rosterSlotsCanSave(picks);
              const color = COLORS[idx % COLORS.length];
              const isActive = activeMultiIdx === idx;
              return (
                <div key={name} style={{ ...panel, border: isActive ? `2px solid ${color}` : "1px solid #e2e8f0", opacity: isActive ? 1 : 0.7 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: 999, background: color }} />
                      <span style={{ fontWeight: 800, fontSize: 14 }}>{name}</span>
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{filled}/{ROSTER_MAX_PLAYERS}</span>
                    </div>
                    {!isActive && <button type="button" onClick={() => setActiveMultiIdx(idx)} style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 8, border: `1px solid ${color}`, background: "white", color, cursor: "pointer" }}>Select</button>}
                    {isActive && <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}20`, padding: "3px 8px", borderRadius: 999 }}>Active ✓</span>}
                  </div>
                  <div style={{ display: "grid", gap: 6, marginBottom: 10 }}>
                    {picks.map((player, slotIdx) => {
                      const slotFlash =
                        lineupFlash?.kind === "multi" &&
                        lineupFlash.participantIdx === idx &&
                        lineupFlash.slotIdx === slotIdx;
                      return (
                      <div
                        key={slotIdx}
                        className={slotFlash ? "select-lineup-slot select-lineup-slot--flash" : "select-lineup-slot"}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 10,
                          background: player.name.trim() ? (player.captain ? "#fefce8" : "#f8fafc") : "#f8fafc",
                          border: player.name.trim() ? (player.captain ? "1px solid #fde68a" : "1px solid #e2e8f0") : "1px dashed #cbd5e1",
                          ...(slotFlash ? ({ "--slot-accent": color } as React.CSSProperties) : {}),
                        }}
                      >
                        <div style={{ width: 22, height: 22, borderRadius: 999, background: player.name.trim() ? color : "#e2e8f0", color: player.name.trim() ? "white" : "#94a3b8", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{slotIdx + 1}</div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: slotIdx < ROSTER_STARTING_COUNT ? "#15803d" : "#6366f1", width: 28, flexShrink: 0 }}>{slotIdx < ROSTER_STARTING_COUNT ? "XI" : "Sub"}</span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                          <button type="button" title="Move up" disabled={slotIdx === 0} onClick={() => moveMultiSlot(idx, slotIdx, -1)} style={{ width: 22, height: 18, fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, background: "white", cursor: slotIdx === 0 ? "not-allowed" : "pointer" }}>↑</button>
                          <button type="button" title="Move down" disabled={slotIdx >= ROSTER_MAX_PLAYERS - 1} onClick={() => moveMultiSlot(idx, slotIdx, 1)} style={{ width: 22, height: 18, fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, background: "white", cursor: slotIdx >= ROSTER_MAX_PLAYERS - 1 ? "not-allowed" : "pointer" }}>↓</button>
                        </div>
                        {player.name.trim() ? (
                          <>
                            <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{player.name}</span>
                            {slotIdx < ROSTER_STARTING_COUNT && (
                              <button type="button" onClick={() => updateMultiCaptain(idx, slotIdx)} style={{ fontSize: 11, padding: "2px 7px", borderRadius: 7, cursor: "pointer", border: player.captain ? "1px solid #d97706" : "1px solid #e2e8f0", background: player.captain ? "#fef9c3" : "white", color: player.captain ? "#d97706" : "#94a3b8", fontWeight: 700 }}>★</button>
                            )}
                            <button type="button" onClick={() => clearMultiSlot(idx, slotIdx)} style={{ width: 22, height: 22, borderRadius: 999, border: "1px solid #fecaca", background: "#fff1f2", color: "#ef4444", cursor: "pointer", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>✕</button>
                          </>
                        ) : (
                          <span style={{ flex: 1, color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>{isActive ? "← tap a name from the list" : "empty"}</span>
                        )}
                      </div>
                    );
                    })}
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
                      : `Fill XI (${rosterStartersFilled(picks)}/${ROSTER_STARTING_COUNT})`}
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
    <div className="select-page">

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
      <div className="select-surface-card select-control-bar">
        <div className="select-control-bar__row">
        <button type="button" className="select-btn-primary" onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit}>
          {syncing ? "Loading…" : "Link IPL Match"}
        </button>
        <div className="select-h2h-progress" aria-label="Save progress">
          <span className={h2hMineSynced ? "select-h2h-pill select-h2h-pill--done" : "select-h2h-pill"}>
            {h2hMineSynced ? "✓ " : ""}{yourName}
          </span>
          <span className={h2hTheirSynced ? "select-h2h-pill select-h2h-pill--done" : "select-h2h-pill"}>
            {h2hTheirSynced ? "✓ " : ""}{rival}
          </span>
          {h2hBothSynced && (
            <a className="select-btn-ghost" href={h2hMatchHref}>
              View match →
            </a>
          )}
        </div>
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
          <div className="select-control-bar__messages">
            {apiMsg
              ? <ApiMessage msg={apiMsg} onDismiss={() => setApiMsg(null)} />
              : <ApiMessage msg={classifyApiMsg(message)} onDismiss={() => setMessage("")} />
            }
          </div>
        )}
      </div>

      {/* ── Match picker ──────────────────────────────────────────────────── */}
      {linkChoices && linkChoices.length > 1 && (
        <div className="select-match-picker">
          <div className="select-match-picker__title">Choose a match</div>
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
        <div className="select-two-col select-two-col--h2h">

        {/* LEFT — Player roster ─────────────────────────────────────────── */}
        <div className="select-roster-panel">
          {/* Panel header */}
          <div className="select-roster-panel__head">
            <div>
              <div className="select-roster-panel__title">Match Players</div>
              <div className="select-roster-panel__sub">
                {hasRoster
                  ? "Picked players disappear here; remove someone from a slot to pick them again"
                  : hasLinkedMatch ? "Load the full squad roster from the API" : "Link a match first"}
              </div>
            </div>
            <div className="select-roster-panel__actions">
              {hasRoster && (
                <button type="button" className="select-btn-secondary-sm" onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing}>
                  {syncing ? "…" : "↺ Refresh roster"}
                </button>
              )}
              {!hasLinkedMatch && (
                <button type="button" className="select-btn-secondary-sm" onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit}>
                  Link Match
                </button>
              )}
            </div>
          </div>

          {/* Active side switcher */}
          {hasRoster && (
            <div className="select-side-segment" role="tablist" aria-label="Which lineup receives roster picks">
              {(["mine", "theirs"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={activeSide === s}
                  onClick={() => setActiveSide(s)}
                  className={
                    activeSide === s
                      ? s === "mine"
                        ? "select-side-segment__btn select-side-segment__btn--active select-side-segment__btn--you"
                        : "select-side-segment__btn select-side-segment__btn--active select-side-segment__btn--opp"
                      : "select-side-segment__btn"
                  }
                >
                  {s === "mine" ? yourName : rival}
                </button>
              ))}
            </div>
          )}

          {/* Roster content */}
          {!hasLinkedMatch ? (
            <div className="select-empty-state">
              <div className="select-empty-state__icon" aria-hidden>🏏</div>
              <div className="select-empty-state__title">No match linked</div>
              <div className="select-empty-state__text">Link an IPL match to load squads and build your lineups.</div>
              <button type="button" className="select-btn-primary" onClick={() => guardedRun(2, doStartLinkTodaysMatch)} disabled={syncing || isAtLimit}>
                Link IPL Match
              </button>
            </div>
          ) : !hasRoster ? (
            <div className="select-empty-state">
              <div className="select-empty-state__icon" aria-hidden>📋</div>
              <div className="select-empty-state__title">Roster not loaded yet</div>
              <div className="select-empty-state__text">Squads usually appear a few hours before the first ball.</div>
              <button type="button" className="select-btn-primary" onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing}>
                {syncing ? "Loading…" : "Load player roster"}
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
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>
                          {sortRosterByFirstName(team.players).filter((n) => !takenNames.has(rosterNameKey(n))).length} available
                          <span style={{ color: "#cbd5e1", margin: "0 4px" }}>·</span>
                          {team.players.length} in squad
                        </span>
                      </div>
                      <div style={rosterPlayersBelowTeam}>
                        {(() => {
                          const avail = sortRosterByFirstName(team.players).filter((n) => !takenNames.has(rosterNameKey(n)));
                          if (avail.length === 0) {
                            return <p className="select-roster-empty-hint">Everyone here is already on a lineup</p>;
                          }
                          const ac = sideColor(activeSide);
                          return avail.map((name, i) => (
                            <button
                              key={`${team.teamName}-${name}`}
                              type="button"
                              onClick={() => applyRosterName(name)}
                              className="select-roster-chip select-roster-chip--h2h"
                              style={{ "--roster-accent": ac } as React.CSSProperties}
                            >
                              <span className="select-roster-chip__idx select-roster-chip__idx--h2h">{i + 1}</span>
                              <span className="select-roster-chip__name">{name}</span>
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={rosterPlayerGrid2}>
                  {(() => {
                    const avail = sortRosterByFirstName(rosterNames).filter((n) => !takenNames.has(rosterNameKey(n)));
                    if (avail.length === 0) {
                      return <p className="select-roster-empty-hint">Everyone is on a lineup — clear a slot to return someone here</p>;
                    }
                    const ac = sideColor(activeSide);
                    return avail.map((name, i) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => applyRosterName(name)}
                        className="select-roster-chip select-roster-chip--h2h"
                        style={{ "--roster-accent": ac } as React.CSSProperties}
                      >
                        <span className="select-roster-chip__idx select-roster-chip__idx--h2h">{i + 1}</span>
                        <span className="select-roster-chip__name">{name}</span>
                      </button>
                    ));
                  })()}
                </div>
              )}
            </>
          )}
        </div>

        {/* RIGHT — Team lineup cards ────────────────────────────────────── */}
        <div className="select-lineup-stack">
          {/* Tip */}
          <div className="select-tip">
            <strong>How it works</strong> — {yourName} and {rival} each pick 4 for points plus up to 3 super subs. Use ↑↓ to reorder. <strong>Save both teams</strong> to open the match screen.
          </div>

          {(["mine", "theirs"] as const).map((side) => {
            const list = side === "mine" ? mine : theirs;
            const name = side === "mine" ? yourName : rival;
            const canSave = side === "mine" ? canSaveMine : canSaveTheirs;
            const isSaving = saving === side;
            const isActive = activeSide === side;
            const color = sideColor(side);
            const bg = sideBg(side);
            const filled = rosterFilledCount(list);
            const startersOk = rosterStartersFilled(list);
            const sideSynced = side === "mine" ? h2hMineSynced : h2hTheirSynced;

            return (
              <div
                key={side}
                className={
                  "select-lineup-card" +
                  (isActive ? " select-lineup-card--active" : "") +
                  (side === "mine" ? " select-lineup-card--you" : " select-lineup-card--opp")
                }
                style={{ "--lineup-accent": color, "--lineup-accent-soft": bg } as React.CSSProperties}
              >
                {/* Card header */}
                <div className="select-lineup-card__head">
                  <div className="select-lineup-card__who">
                    <div className="select-lineup-card__dot" style={{ background: color }} />
                    <div>
                      <div className="select-lineup-card__name">{name}</div>
                      <div className="select-lineup-card__meta">
                        {filled}/{ROSTER_MAX_PLAYERS} picks · XI {startersOk}/{ROSTER_STARTING_COUNT} · one captain
                        {sideSynced ? " · saved" : ""}
                      </div>
                    </div>
                  </div>
                  {!isActive && (
                    <button type="button" className="select-lineup-card__pick" onClick={() => setActiveSide(side)} style={{ borderColor: color, color }}>
                      Edit this side
                    </button>
                  )}
                  {isActive && (
                    <span className="select-lineup-card__active" style={{ color, background: bg }}>
                      Building
                    </span>
                  )}
                </div>

                {/* Opponent name field */}
                {side === "theirs" && (
                  <div className="select-lineup-card__field">
                    <label className="select-lineup-card__label" htmlFor="select-rival-name">
                      Opponent display name
                    </label>
                    <input id="select-rival-name" value={rival} onChange={(e) => setRival(e.target.value)} className="select-input" placeholder="e.g. Rahul" />
                  </div>
                )}

                {/* Player slots */}
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {list.map((player, index) => {
                    const filled = Boolean(player.name.trim());
                    const slotFlash =
                      lineupFlash?.kind === "h2h" &&
                      lineupFlash.side === side &&
                      lineupFlash.slotIdx === index;
                    return (
                      <div
                        key={index}
                        className={slotFlash ? "select-lineup-slot select-lineup-slot--flash" : "select-lineup-slot"}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", borderRadius: 12,
                          background: filled ? (player.captain ? "#fefce8" : "#f8fafc") : "#f8fafc",
                          border: filled
                            ? player.captain ? "1px solid #fde68a" : "1px solid #e2e8f0"
                            : "1px dashed #cbd5e1",
                          minHeight: 48,
                          ...(slotFlash ? ({ "--slot-accent": color } as React.CSSProperties) : {}),
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
                        <span style={{ fontSize: 10, fontWeight: 700, color: index < ROSTER_STARTING_COUNT ? "#15803d" : "#6366f1", width: 30, flexShrink: 0 }}>{index < ROSTER_STARTING_COUNT ? "XI" : "Sub"}</span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                          <button type="button" title="Move up" disabled={index === 0} onClick={() => moveH2hSlot(side, index, -1)} style={{ width: 24, height: 18, fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, background: "white", cursor: index === 0 ? "not-allowed" : "pointer" }}>↑</button>
                          <button type="button" title="Move down" disabled={index >= ROSTER_MAX_PLAYERS - 1} onClick={() => moveH2hSlot(side, index, 1)} style={{ width: 24, height: 18, fontSize: 10, border: "1px solid #e2e8f0", borderRadius: 4, background: "white", cursor: index >= ROSTER_MAX_PLAYERS - 1 ? "not-allowed" : "pointer" }}>↓</button>
                        </div>

                        {filled ? (
                          <>
                            <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: "#0f172a" }}>{player.name}</span>
                            {index < ROSTER_STARTING_COUNT && (
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
                            )}
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
                            {isActive ? "← choose from the list on the left" : "empty"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Save button */}
                <button
                  type="button"
                  className={
                    "select-save-lineup" +
                    (sideSynced ? " select-save-lineup--synced" : "") +
                    (!canSave || saving !== null ? " select-save-lineup--disabled" : "")
                  }
                  onClick={() => void saveSide(side)}
                  disabled={!canSave || saving !== null}
                  style={{ "--lineup-accent": color } as React.CSSProperties}
                >
                  {isSaving
                    ? "Saving…"
                    : sideSynced
                      ? `Update ${name}'s team`
                      : canSave
                        ? `Save ${name}'s team`
                        : `Fill XI (${rosterStartersFilled(list)}/${ROSTER_STARTING_COUNT})`}
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
const warnStyle: CSSProperties = { border: "2px solid #fcd34d", borderRadius: 16, background: "#fffbeb", padding: 16 };

// Legacy aliases so any other file importing these still works
export const panelStyle = panel;
export const chipGrid: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
export const chip: CSSProperties = { padding: "7px 14px", borderRadius: 999, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", cursor: "pointer", fontSize: 13, fontWeight: 500 };
export const chipTaken: CSSProperties = { ...chip, background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "not-allowed", opacity: 0.55, textDecoration: "line-through" };
