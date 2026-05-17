"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatFixture } from "@/lib/format";
import { formatUiCalendarDate } from "@/lib/ui-time";
import type { CSSProperties } from "react";
import ApiMessage from "@/components/ApiMessage";
import { classifyApiMsg, type ApiMsg } from "@/lib/api-message";
import { navigateToMatchAfterSeed } from "@/lib/post-seed-nav-client";
import { rosterNameKey, sortRosterByPickCountThenName } from "@/lib/roster-pick-order";
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
import {
  anyKeyBlocked,
  combinedHitsFromKeyStats,
  combinedQuotaCap,
  FALLBACK_QUOTA_CAP,
  type KeyStatsApiResponse,
} from "@/lib/combined-quota";
import {
  type MatchChoice,
  emptyFixtureListCopy,
  fetchMatchesToday,
  fixturePickerBannerCopy,
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
  } catch { return 0; }
}
function saveQuota(count: number) {
  try { localStorage.setItem(QUOTA_KEY, JSON.stringify({ count, date: formatUiCalendarDate() })); } catch {}
}

type KeyStatRow = {
  alias: string;
  hits: number;
  blocked?: boolean;
  blockReason?: string | null;
  resumesInMin?: number | null;
  staleQuotaFlag?: boolean;
};

function SelectQuotaCluster({
  apiUsed,
  quotaCap,
  isAtLimit,
  isNearLimit,
  keyStats,
  resettingBlocks,
  setResettingBlocks,
  setApiMsg,
  refreshKeyStats,
}: {
  apiUsed: number;
  quotaCap: number;
  isAtLimit: boolean;
  isNearLimit: boolean;
  keyStats: KeyStatRow[];
  resettingBlocks: boolean;
  setResettingBlocks: (v: boolean) => void;
  setApiMsg: (m: ApiMsg | null) => void;
  refreshKeyStats: () => void;
}) {
  return (
    <div className="select-toolbar__api">
      <span
        className={
          "select-quota-badge" +
          (isAtLimit ? " select-quota-badge--limit" : isNearLimit ? " select-quota-badge--warn" : "")
        }
        title="Total CricAPI hits today summed across all configured keys"
      >
        {apiUsed}/{quotaCap} credits (all keys)
      </span>
      {anyKeyBlocked(keyStats) && (
        <button
          type="button"
          className="select-btn-clear-blocks"
          disabled={resettingBlocks}
          title="Clear rate-limit blocks so all keys are retried"
          onClick={async () => {
            setResettingBlocks(true);
            try {
              const r = await fetch("/api/reset-key-blocks", { method: "POST" });
              const j = await r.json();
              setApiMsg({ type: j.ok ? "success" : "error", title: j.message || j.error || "Done" });
              refreshKeyStats();
            } catch {
              setApiMsg({ type: "error", title: "Could not reset blocks" });
            }
            setResettingBlocks(false);
          }}
        >
          {resettingBlocks ? "…" : "↺ Clear blocks"}
        </button>
      )}
    </div>
  );
}

type Player = RosterSlotPlayer;
type SquadTeam = { teamName: string; players: string[] };

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
  /**
   * Keys from `rosterNameKey(name)` → times this player was saved in any lineup for this competition.
   * When set, roster chips list most-picked names first (then A–Z).
   */
  pickCounts?: Record<string, number> | null;
};

export default function SelectClient({
  yourName,
  opponentName,
  yourPlayers,
  opponentPlayers,
  rosterNames,
  squads,
  nameToId,
  hasLinkedMatch,
  matchId,
  competitionId,
  compPlayers,
  existingPicks,
  afterLineupSaveHref,
  pickCounts = null,
}: Props) {
  const router = useRouter();
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
        router.refresh();
        const newSaved = new Set(savedSet).add(idx);
        setSavedSet(newSaved);
        const allDone = newSaved.size >= multiPlayers.length;
        if (allDone) {
          setApiMsg({ type: "success", title: "All teams saved! Opening match…" });
          const p = new URLSearchParams();
          if (competitionId != null) p.set("c", String(competitionId));
          if (matchId != null) p.set("m", String(matchId));
          const dest = p.toString() ? `/match?${p.toString()}` : "/match";
          window.setTimeout(() => {
            window.location.href = dest;
          }, 900);
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
  const [fixtureListSource, setFixtureListSource] = useState<"cache" | "api" | null>(null);
  const [apiUsed, setApiUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number } | null>(null);
  const [keyStats, setKeyStats] = useState<{
    alias: string; hits: number; blocked?: boolean; blockReason?: string | null;
    resumesInMin?: number | null; staleQuotaFlag?: boolean;
  }[]>([]);
  const [quotaCap, setQuotaCap] = useState(FALLBACK_QUOTA_CAP);
  const [resettingBlocks, setResettingBlocks] = useState(false);

  const refreshKeyStats = useCallback(() => {
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
    refreshKeyStats();
  }, [refreshKeyStats]);

  const addUsage = useCallback((n: number) => {
    setApiUsed((prev) => { const next = prev + n; saveQuota(next); return next; });
  }, []);

  const warnAt = Math.floor(quotaCap * 0.8);
  const remaining = quotaCap - apiUsed;
  const isNearLimit = apiUsed >= warnAt;
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

  /** Pick-frequency order for roster chips — used in both multi (3+) and H2H layouts. */
  const orderNamesForRosterChips = useCallback(
    (names: string[]) => sortRosterByPickCountThenName(names, pickCounts),
    [pickCounts]
  );

  const hasRoster = rosterNames.length > 0 || squads.some((t) => t.players.length > 0);

  const showMsg = useCallback((text: string, context?: string) => {
    setApiMsg(classifyApiMsg(text, context));
    setMessage(""); // clear the old plain string
  }, []);

  function guardedRun(cost: number, fn: () => Promise<void>) {
    if (isAtLimit && cost > 0) {
      setApiMsg(classifyApiMsg("Daily API quota exhausted", "Quota"));
      return;
    }
    if (isNearLimit && cost > 0) {
      setPendingAction({ fn, cost });
      return;
    }
    void fn();
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
      refreshKeyStats();
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
    const json = await fetchMatchesToday(refresh, { debugLabel: "select-matches-today" });
    if (shouldDebitFixtureListCredits(json.source)) addUsage(2);
    refreshKeyStats();
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

  async function doStartLinkTodaysMatch() {
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

  async function doFetchRoster() {
    setSyncing(true);
    setApiMsg({ type: "loading", title: "Fetching player roster…" });
    try {
      const res = await fetch("/api/fetch-roster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(matchId != null ? { matchId } : {}),
      });
      const json = await res.json();
      if (json.source === "api") addUsage(1);
      refreshKeyStats();
      if (json.ok) {
        setApiMsg({
          type: "success",
          title:
            json.source === "cache"
              ? `Using saved roster — ${json.playerCount} players. Refreshing…`
              : `Roster loaded — ${json.playerCount} players. Refreshing…`,
        });
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
        router.refresh();
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
            // Full navigation reloads RSC props and exits the inline picker (router.refresh alone is not enough).
            window.setTimeout(() => {
              window.location.assign(dest);
            }, 500);
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
      <div className="select-studio-root select-page select-page--premium">
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

        {pendingAction && (
          <div style={warnStyle}>
            <div style={{ fontWeight: 700, color: "#92400e", marginBottom: 6 }}>⚠️ Low on API credits</div>
            <div style={{ color: "#78350f", fontSize: 14, marginBottom: 12 }}>
              {remaining} credit{remaining === 1 ? "" : "s"} left. This action uses {pendingAction.cost}. Continue?
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                style={btnDark}
                onClick={() => {
                  const a = pendingAction;
                  setPendingAction(null);
                  void a.fn();
                }}
              >
                Yes, proceed
              </button>
              <button type="button" style={btnOutline} onClick={() => setPendingAction(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="select-surface-card select-control-bar">
          <div className="select-control-bar__row">
            <button
              type="button"
              className="select-btn-primary"
              onClick={() => guardedRun(0, doStartLinkTodaysMatch)}
              disabled={syncing}
            >
              {syncing ? "Loading…" : "Link IPL Match"}
            </button>
            <div className="select-h2h-progress" aria-label="Save progress">
              {multiPlayers.map((name, i) => (
                <span
                  key={name}
                  className={savedSet.has(i) ? "select-h2h-pill select-h2h-pill--done" : "select-h2h-pill"}
                >
                  {savedSet.has(i) ? "✓ " : ""}
                  {name}
                </span>
              ))}
              {savedSet.size > 0 && (
                <button type="button" className="select-btn-ghost" onClick={() => window.location.reload()}>
                  {savedSet.size >= multiPlayers.length
                    ? "View scores →"
                    : `View scores (${multiPlayers.length - savedSet.size} pending) →`}
                </button>
              )}
            </div>
            <SelectQuotaCluster
              apiUsed={apiUsed}
              quotaCap={quotaCap}
              isAtLimit={isAtLimit}
              isNearLimit={isNearLimit}
              keyStats={keyStats}
              resettingBlocks={resettingBlocks}
              setResettingBlocks={setResettingBlocks}
              setApiMsg={setApiMsg}
              refreshKeyStats={refreshKeyStats}
            />
          </div>
          {apiMsg && !linkChoices && (
            <div className="select-control-bar__messages">
              <ApiMessage msg={apiMsg} onDismiss={() => setApiMsg(null)} />
            </div>
          )}
        </div>

        {linkChoices && linkChoices.length > 1 && (
          <div className="select-match-picker">
            <div className="select-match-picker__title">Choose a match</div>
            {linkDateHint && (
              <div className="select-match-picker__hint">Showing ±1 day (Eastern) · {linkDateHint}</div>
            )}
            {fixtureListSource === "cache" && (
              <div className="select-match-picker__hint" style={{ color: "#0369a1", background: "#e0f2fe", padding: "8px 10px", borderRadius: 8 }}>
                Using saved fixture list — no API call. Use the button below if a match is missing.
              </div>
            )}
            <div className="select-match-picker__grid">
              {linkChoices.map((c) => {
                const picked = pickedLinkId === c.externalMatchId;
                return (
                  <label
                    key={c.externalMatchId || c.fixture}
                    className={picked ? "select-match-option select-match-option--picked" : "select-match-option"}
                  >
                    <input
                      type="radio"
                      name="lp"
                      checked={picked}
                      onChange={() => setPickedLinkId(c.externalMatchId || "")}
                      style={{ accentColor: "#2563eb" }}
                    />
                    <div className="select-match-option__body">
                      <div className="select-match-option__fixture">{formatFixture(c.fixture) || c.fixture}</div>
                      <div className="select-match-option__meta">
                        {c.status}
                        {c.venue ? ` · ${c.venue}` : ""}
                        {c.match_date ? ` · ${c.match_date}` : ""}
                      </div>
                    </div>
                    {picked && <span aria-hidden style={{ fontSize: 18, color: "#1d4ed8" }}>✓</span>}
                  </label>
                );
              })}
            </div>
            <div className="select-match-picker__actions">
              <button
                type="button"
                className="select-btn-primary"
                onClick={() => void (guardedRun(1, () => doSubmitSeedLink(pickedLinkId)))}
                disabled={syncing || !pickedLinkId}
              >
                {syncing ? "Linking…" : "Link selected"}
              </button>
              <button
                type="button"
                className="select-btn-secondary-sm"
                onClick={() => {
                  setLinkChoices(null);
                  setApiMsg(null);
                  setFixtureListSource(null);
                }}
              >
                Cancel
              </button>
            </div>
            {fixtureListSource === "cache" && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Fixture not listed? Pull the latest IPL list from CricAPI (uses ~2 API credits).</div>
                <button type="button" className="select-btn-secondary-sm" onClick={() => guardedRun(2, doRefreshFixtureListFromApi)} disabled={syncing}>
                  {syncing ? "Loading…" : "Refresh list from API"}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="select-two-col select-two-col--h2h">
          <div className="select-roster-panel">
            <div className="select-roster-panel__head">
              <div>
                <div className="select-roster-panel__title">Match Players</div>
                <div className="select-roster-panel__sub">
                  {hasRoster
                    ? "Picked players disappear here; remove someone from a slot to pick them again"
                    : hasLinkedMatch
                      ? "Load the full squad roster from the API"
                      : "Link a match first"}
                </div>
              </div>
              <div className="select-roster-panel__actions">
                {hasRoster && (
                  <button
                    type="button"
                    className="select-btn-secondary-sm"
                    onClick={() => guardedRun(1, doFetchRoster)}
                    disabled={syncing}
                  >
                    {syncing ? "…" : "↺ Refresh roster"}
                  </button>
                )}
                {!hasLinkedMatch && (
                  <button
                    type="button"
                    className="select-btn-secondary-sm"
                    onClick={() => guardedRun(0, doStartLinkTodaysMatch)}
                    disabled={syncing}
                  >
                    Link Match
                  </button>
                )}
              </div>
            </div>

            {hasRoster && (
              <div className="select-side-segment" role="tablist" aria-label="Which lineup receives roster picks">
                {multiPlayers.map((name, i) => {
                  const active = activeMultiIdx === i;
                  return (
                    <button
                      key={name}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveMultiIdx(i)}
                      className={
                        active
                          ? "select-side-segment__btn select-side-segment__btn--active select-side-segment__btn--multi"
                          : "select-side-segment__btn"
                      }
                      style={
                        active
                          ? ({ "--multi-segment-accent": COLORS[i % COLORS.length] } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}

            {!hasLinkedMatch ? (
              <div className="select-empty-state">
                <div className="select-empty-state__icon" aria-hidden>
                  🏏
                </div>
                <div className="select-empty-state__title">No match linked</div>
                <div className="select-empty-state__text">Link an IPL match to load squads and build every lineup.</div>
                <button
                  type="button"
                  className="select-btn-primary"
                  onClick={() => guardedRun(0, doStartLinkTodaysMatch)}
                  disabled={syncing}
                >
                  Link IPL Match
                </button>
              </div>
            ) : !hasRoster ? (
              <div className="select-empty-state">
                <div className="select-empty-state__icon" aria-hidden>
                  📋
                </div>
                <div className="select-empty-state__title">Roster not loaded yet</div>
                <div className="select-empty-state__text">Squads usually appear a few hours before the first ball.</div>
                <button type="button" className="select-btn-primary" onClick={() => guardedRun(1, doFetchRoster)} disabled={syncing}>
                  {syncing ? "Loading…" : "Load player roster"}
                </button>
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
                {squads.map((team) => {
                  const avail = orderNamesForRosterChips(team.players).filter(
                    (n) => !allTakenKeysMulti.has(rosterNameKey(n))
                  );
                  const ac = COLORS[activeMultiIdx % COLORS.length];
                  return (
                    <div key={team.teamName} style={{ minWidth: 0 }}>
                      <div className="select-squad-head">
                        <div className="select-squad-head__bar" aria-hidden />
                        <span className="select-squad-head__name">{team.teamName}</span>
                        <span className="select-squad-head__meta">
                          {avail.length} available · {team.players.length} in squad
                        </span>
                      </div>
                      <div className="select-roster-below-team">
                        {avail.length === 0 ? (
                          <p className="select-roster-empty-hint">All players from this squad are on a lineup</p>
                        ) : (
                          avail.map((name, i) => (
                            <button
                              key={`${team.teamName}-${name}`}
                              type="button"
                              onClick={() => applyMultiRoster(name)}
                              className="select-roster-chip select-roster-chip--h2h"
                              style={{ "--roster-accent": ac } as React.CSSProperties}
                            >
                              <span className="select-roster-chip__idx select-roster-chip__idx--h2h">{i + 1}</span>
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
              <div className="select-roster-grid">
                {(() => {
                  const avail = orderNamesForRosterChips(rosterNames).filter(
                    (n) => !allTakenKeysMulti.has(rosterNameKey(n))
                  );
                  const ac = COLORS[activeMultiIdx % COLORS.length];
                  if (avail.length === 0) {
                    return (
                      <p className="select-roster-empty-hint">
                        Everyone is on a lineup — clear a slot to return someone here
                      </p>
                    );
                  }
                  return avail.map((name, i) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => applyMultiRoster(name)}
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
          </div>

          <div className="select-lineup-stack">
            <div className="select-tip">
              <strong>How it works</strong> — Each person picks 4 for points plus up to 3 super subs. Use ↑↓ to reorder slots.
              Switch tabs to edit another lineup. <strong>Save each team</strong> before viewing scores.
            </div>
            {multiPlayers.map((name, idx) => {
              const picks = allPicks[idx] ?? [];
              const filled = rosterFilledCount(picks);
              const startersOk = rosterStartersFilled(picks);
              const canS = rosterSlotsCanSave(picks);
              const color = COLORS[idx % COLORS.length];
              const isActive = activeMultiIdx === idx;
              return (
                <div
                  key={name}
                  className={
                    "select-lineup-card" + (isActive ? " select-lineup-card--active" : "")
                  }
                  style={{ "--lineup-accent": color } as React.CSSProperties}
                >
                  <div className="select-lineup-card__head">
                    <div className="select-lineup-card__who">
                      <div className="select-lineup-card__dot" style={{ background: color }} />
                      <div>
                        <div className="select-lineup-card__name">{name}</div>
                        <div className="select-lineup-card__meta">
                          {filled}/{ROSTER_MAX_PLAYERS} picks · XI {startersOk}/{ROSTER_STARTING_COUNT} · one captain
                          {savedSet.has(idx) ? " · saved" : ""}
                        </div>
                      </div>
                    </div>
                    {!isActive && (
                      <button
                        type="button"
                        className="select-lineup-card__pick"
                        onClick={() => setActiveMultiIdx(idx)}
                        style={{ borderColor: color, color }}
                      >
                        Edit this lineup
                      </button>
                    )}
                    {isActive && (
                      <span
                        className="select-lineup-card__active"
                        style={{ color, background: `${color}18` }}
                      >
                        Building
                      </span>
                    )}
                  </div>

                  <div className="select-slot-grid">
                    {picks.map((player, slotIdx) => {
                      const slotFilled = Boolean(player.name.trim());
                      const isBench = slotIdx >= ROSTER_STARTING_COUNT;
                      const slotFlash =
                        lineupFlash?.kind === "multi" &&
                        lineupFlash.participantIdx === idx &&
                        lineupFlash.slotIdx === slotIdx;
                      const slotClass = [
                        "select-lineup-slot",
                        "select-slot",
                        slotFilled ? "select-slot--filled" : "select-slot--empty",
                        slotFilled && player.captain ? "select-slot--captain" : "",
                        isBench ? "select-slot--bench" : "",
                        slotFlash ? "select-lineup-slot--flash" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <div
                          key={slotIdx}
                          className={slotClass}
                          style={{ "--slot-accent": color } as React.CSSProperties}
                        >
                          <div className="select-slot__num">{slotIdx + 1}</div>
                          <span className="select-slot__role">{isBench ? "Sub" : "XI"}</span>
                          <div className="select-slot__moves">
                            <button
                              type="button"
                              className="select-slot__nudge"
                              title="Move up"
                              disabled={slotIdx === 0}
                              onClick={() => moveMultiSlot(idx, slotIdx, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="select-slot__nudge"
                              title="Move down"
                              disabled={slotIdx >= ROSTER_MAX_PLAYERS - 1}
                              onClick={() => moveMultiSlot(idx, slotIdx, 1)}
                            >
                              ↓
                            </button>
                          </div>
                          {slotFilled ? (
                            <>
                              <span className="select-slot__name">{player.name}</span>
                              {slotIdx < ROSTER_STARTING_COUNT && (
                                <button
                                  type="button"
                                  className={
                                    "select-slot__cap" + (player.captain ? " select-slot__cap--on" : "")
                                  }
                                  onClick={() => updateMultiCaptain(idx, slotIdx)}
                                  title="Set as captain (×2 pts)"
                                >
                                  ★ {player.captain ? "Captain" : "Cap?"}
                                </button>
                              )}
                              <button
                                type="button"
                                className="select-slot__remove"
                                onClick={() => clearMultiSlot(idx, slotIdx)}
                                aria-label="Remove player"
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <span className="select-slot__placeholder">
                              {isActive ? "← choose from the list on the left" : "empty"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className={
                      "select-save-lineup" +
                      (savedSet.has(idx) ? " select-save-lineup--synced" : "") +
                      (!canS || savingIdx !== null ? " select-save-lineup--disabled" : "")
                    }
                    onClick={() => void saveParticipant(idx)}
                    disabled={!canS || savingIdx !== null}
                    style={{ "--lineup-accent": color } as React.CSSProperties}
                  >
                    {savingIdx === idx
                      ? "Saving…"
                      : savedSet.has(idx)
                        ? `Update ${name}'s team`
                        : canS
                          ? `Save ${name}'s team`
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
    <div className="select-studio-root select-page select-page--premium">

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
        <button type="button" className="select-btn-primary" onClick={() => guardedRun(0, doStartLinkTodaysMatch)} disabled={syncing}>
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
        <SelectQuotaCluster
          apiUsed={apiUsed}
          quotaCap={quotaCap}
          isAtLimit={isAtLimit}
          isNearLimit={isNearLimit}
          keyStats={keyStats}
          resettingBlocks={resettingBlocks}
          setResettingBlocks={setResettingBlocks}
          setApiMsg={setApiMsg}
          refreshKeyStats={refreshKeyStats}
        />
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
          {linkDateHint && (
            <div className="select-match-picker__hint">Showing ±1 day (Eastern) · {linkDateHint}</div>
          )}
          {fixtureListSource === "cache" && (
            <div className="select-match-picker__hint" style={{ color: "#0369a1", background: "#e0f2fe", padding: "8px 10px", borderRadius: 8 }}>
              Using saved fixture list — no API call. Use the button below if a match is missing.
            </div>
          )}
          <div className="select-match-picker__grid">
            {linkChoices.map((c) => {
              const picked = pickedLinkId === c.externalMatchId;
              return (
                <label
                  key={c.externalMatchId || c.fixture}
                  className={picked ? "select-match-option select-match-option--picked" : "select-match-option"}
                >
                  <input
                    type="radio"
                    name="lp"
                    checked={picked}
                    onChange={() => setPickedLinkId(c.externalMatchId || "")}
                    style={{ accentColor: "#2563eb" }}
                  />
                  <div className="select-match-option__body">
                    <div className="select-match-option__fixture">{formatFixture(c.fixture) || c.fixture}</div>
                    <div className="select-match-option__meta">
                      {c.status}
                      {c.venue ? ` · ${c.venue}` : ""}
                      {c.match_date ? ` · ${c.match_date}` : ""}
                    </div>
                  </div>
                  {picked && <span aria-hidden style={{ fontSize: 18, color: "#1d4ed8" }}>✓</span>}
                </label>
              );
            })}
          </div>
          <div className="select-match-picker__actions">
            <button
              type="button"
              className="select-btn-primary"
              onClick={() => void (guardedRun(1, () => doSubmitSeedLink(pickedLinkId)))}
              disabled={syncing || !pickedLinkId}
            >
              {syncing ? "Linking…" : "Link selected match"}
            </button>
            <button
              type="button"
              className="select-btn-secondary-sm"
              onClick={() => {
                setLinkChoices(null);
                setMessage("");
                setFixtureListSource(null);
              }}
            >
              Cancel
            </button>
          </div>
          {fixtureListSource === "cache" && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>Fixture not listed? Pull the latest IPL list from CricAPI (uses ~2 API credits).</div>
              <button type="button" className="select-btn-secondary-sm" onClick={() => guardedRun(2, doRefreshFixtureListFromApi)} disabled={syncing}>
                {syncing ? "Loading…" : "Refresh list from API"}
              </button>
            </div>
          )}
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
                <button type="button" className="select-btn-secondary-sm" onClick={() => guardedRun(0, doStartLinkTodaysMatch)} disabled={syncing}>
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
              <button type="button" className="select-btn-primary" onClick={() => guardedRun(0, doStartLinkTodaysMatch)} disabled={syncing}>
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
                      <div className="select-squad-head">
                        <div className="select-squad-head__bar" aria-hidden />
                        <span className="select-squad-head__name">{team.teamName}</span>
                        <span className="select-squad-head__meta">
                          {team.players.filter((n) => !takenNames.has(rosterNameKey(n))).length}{" "}
                          available · {team.players.length} in squad
                        </span>
                      </div>
                      <div className="select-roster-below-team">
                        {(() => {
                          const avail = orderNamesForRosterChips(team.players).filter((n) => !takenNames.has(rosterNameKey(n)));
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
                <div className="select-roster-grid">
                  {(() => {
                    const avail = orderNamesForRosterChips(rosterNames).filter((n) => !takenNames.has(rosterNameKey(n)));
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

                <div className="select-slot-grid">
                  {list.map((player, index) => {
                    const filled = Boolean(player.name.trim());
                    const isBench = index >= ROSTER_STARTING_COUNT;
                    const slotFlash =
                      lineupFlash?.kind === "h2h" &&
                      lineupFlash.side === side &&
                      lineupFlash.slotIdx === index;
                    const slotClass = [
                      "select-lineup-slot",
                      "select-slot",
                      filled ? "select-slot--filled" : "select-slot--empty",
                      filled && player.captain ? "select-slot--captain" : "",
                      isBench ? "select-slot--bench" : "",
                      slotFlash ? "select-lineup-slot--flash" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <div
                        key={index}
                        className={slotClass}
                        style={{ "--slot-accent": color } as React.CSSProperties}
                      >
                        <div className="select-slot__num">{index + 1}</div>
                        <span className="select-slot__role">{isBench ? "Sub" : "XI"}</span>
                        <div className="select-slot__moves">
                          <button
                            type="button"
                            className="select-slot__nudge"
                            title="Move up"
                            disabled={index === 0}
                            onClick={() => moveH2hSlot(side, index, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="select-slot__nudge"
                            title="Move down"
                            disabled={index >= ROSTER_MAX_PLAYERS - 1}
                            onClick={() => moveH2hSlot(side, index, 1)}
                          >
                            ↓
                          </button>
                        </div>

                        {filled ? (
                          <>
                            <span className="select-slot__name">{player.name}</span>
                            {index < ROSTER_STARTING_COUNT && (
                              <button
                                type="button"
                                className={
                                  "select-slot__cap" + (player.captain ? " select-slot__cap--on" : "")
                                }
                                onClick={() => updateCaptain(side, index)}
                                title="Set as captain (×2 pts)"
                              >
                                ★ {player.captain ? "Captain" : "Cap?"}
                              </button>
                            )}
                            <button
                              type="button"
                              className="select-slot__remove"
                              onClick={() => {
                                clearSlot(side, index);
                                ensureOneCaptain(side);
                              }}
                              aria-label="Remove player"
                            >
                              ✕
                            </button>
                          </>
                        ) : (
                          <span className="select-slot__placeholder">
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
const warnStyle: CSSProperties = { border: "2px solid #fcd34d", borderRadius: 16, background: "#fffbeb", padding: 16 };

// Legacy aliases so any other file importing these still works
export const panelStyle = panel;
export const chipGrid: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
export const chip: CSSProperties = { padding: "7px 14px", borderRadius: 999, border: "1px solid #cbd5e1", background: "white", color: "#0f172a", cursor: "pointer", fontSize: 13, fontWeight: 500 };
export const chipTaken: CSSProperties = { ...chip, background: "#f8fafc", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "not-allowed", opacity: 0.55, textDecoration: "line-through" };
