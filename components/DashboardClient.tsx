"use client";

import React, { useEffect, useMemo, useState, useCallback, type CSSProperties } from "react";

const QUOTA_LIMIT = 200; // 100/day × 2 API keys
const QUOTA_WARN_AT = 160;
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
  } catch {
    return 0;
  }
}

function saveQuota(count: number) {
  try {
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ count, date: getIstDateStr() }));
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

type Props = {
  opponentName: string;
  yourPlayers: Player[];
  opponentPlayers: Player[];
  rosterNames: string[];
  squads: SquadTeam[];
  hasLinkedMatch: boolean;
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
  if (!info) return null;
  const details = info.debug;
  return (
    <div style={debugPanelStyle}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Latest sync debug</div>
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
          <strong>Sync time:</strong> {details.syncedAt || details.lastSyncedAt}
        </div>
      ) : null}
      {details?.unmatched?.length ? (
        <div style={debugLineStyle}>
          <strong>Unmatched selected players:</strong> {details.unmatched.join(", ")}
        </div>
      ) : null}
      {details?.matched?.length ? (
        <div style={debugLineStyle}>
          <strong>Name matches:</strong> {details.matched.map((m) => `${m.selected} -> ${m.provider}`).join(", ")}
        </div>
      ) : null}
      {details?.providerPlayersSample?.length ? (
        <div style={debugLineStyle}>
          <strong>Provider player sample:</strong> {details.providerPlayersSample.join(", ")}
        </div>
      ) : null}
      {typeof details?.rosterCount === "number" ? (
        <div style={debugLineStyle}>
          <strong>Roster names cached:</strong> {details.rosterCount}
        </div>
      ) : null}
      {details?.sourceUrl ? (
        <div style={debugLineStyle}>
          <strong>Source URL:</strong> <a href={details.sourceUrl} target="_blank" rel="noreferrer">{details.sourceUrl}</a>
        </div>
      ) : null}
    </div>
  );
}

export default function DashboardClient({
  opponentName,
  yourPlayers,
  opponentPlayers,
  rosterNames,
  squads,
  hasLinkedMatch,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [debugInfo, setDebugInfo] = useState<DebugData | null>(null);
  const [rival, setRival] = useState(opponentName || "Rahul");
  const [mine, setMine] = useState<Player[]>(withFallback(yourPlayers));
  const [theirs, setTheirs] = useState<Player[]>(withFallback(opponentPlayers));
  // Which side the roster chips will fill into
  const [activeSide, setActiveSide] = useState<"mine" | "theirs">("mine");
  const [linkChoices, setLinkChoices] = useState<MatchChoice[] | null>(null);
  const [pickedLinkId, setPickedLinkId] = useState("");
  const [linkDateHint, setLinkDateHint] = useState("");
  const [apiUsed, setApiUsed] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ fn: () => Promise<void>; cost: number; label: string } | null>(null);

  useEffect(() => {
    setApiUsed(loadQuota());
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

  // All names already committed to either side
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

  function guardedRun(cost: number, label: string, fn: () => Promise<void>) {
    if (isAtLimit) {
      setMessage(`API quota reached (${QUOTA_LIMIT}/day). Resets at midnight India time.`);
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
      setMessage(json.ok ? "Match linked. Refreshing…" : json.error || "Could not link match.");
      if (json.ok) window.location.reload();
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
        const hint = typeof json.totalRaw === "number"
          ? json.totalRaw === 0
            ? "API returned 0 matches — rate-limited or quota exhausted. Try again in 15 min."
            : `${json.totalRaw} matches in feed but none were IPL. Season may not have started yet.`
          : "No IPL matches found. Check quota or try again later.";
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
      setMessage(`${choices.length} matches found — pick one below.`);
    } catch {
      setMessage("Network error loading today's matches.");
    }
    setSyncing(false);
  }

  function startLinkTodaysMatch() {
    guardedRun(2, "Load today's matches (2 credits)", doStartLinkTodaysMatch);
  }

  async function doRefreshNow() {
    setSyncing(true);
    setMessage("Refreshing from cricket source...");
    const res = await fetch("/api/refresh", { method: "POST" });
    const json = await res.json();
    setSyncing(false);
    setDebugInfo(json);
    if (!json.skipped) addUsage(1);
    if (json.ok) {
      setMessage(json.reason || json.message || (json.skipped ? "Using cached data." : "Dashboard updated."));
      if (!json.skipped) window.setTimeout(() => window.location.reload(), 1200);
    } else {
      setMessage(json.error || "Refresh failed.");
    }
  }

  function refreshNow() {
    guardedRun(1, "Sync scores (1 credit)", doRefreshNow);
  }

  async function saveLineup() {
    setSaving(true);
    setMessage("Saving lineup...");
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
    setDebugInfo(json);
    setMessage(json.ok ? "Lineup saved. Refreshing..." : json.error || "Could not save lineup.");
    if (json.ok) window.location.reload();
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
        const cleared = { name: "", captain: false };
        // If the cleared slot was captain, promote first remaining non-empty slot
        if (player.captain) {
          return cleared;
        }
        return cleared;
      })
    );
  }

  // Ensure exactly one captain per side after clearing
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

  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
      {/* Quota bar */}
      <div style={quotaBarContainerStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: isAtLimit ? "#b91c1c" : isNearLimit ? "#92400e" : "#475569" }}>
            API credits today: {apiUsed} / {QUOTA_LIMIT}
          </span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>resets midnight IST</span>
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
            ⚠️ Only {remaining} credit{remaining === 1 ? "" : "s"} left — auto-refresh is off. Use Sync manually.
          </div>
        )}
        {isAtLimit && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>
            Quota reached. Resets at midnight India time.
          </div>
        )}
      </div>

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

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => void startLinkTodaysMatch()} disabled={syncing || isAtLimit} style={buttonStyle}>
          {syncing ? "Working..." : "Link Today's Match"}
        </button>
        <button onClick={() => void refreshNow()} disabled={syncing || isAtLimit} style={buttonStyleSecondary}>
          {syncing ? "Working..." : "Sync Scores Now"}
        </button>
      </div>

      {linkChoices && linkChoices.length > 1 ? (
        <div style={pickerPanelStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Which match do you want to link?</div>
          {linkDateHint ? (
            <div style={{ color: "#64748b", fontSize: 13, marginBottom: 12 }}>Using India calendar: {linkDateHint}</div>
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
                  <div style={{ fontWeight: 600, color: "#0f172a" }}>{c.fixture}</div>
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
          <div style={{ color: "#64748b", fontSize: 14 }}>Link today&apos;s IPL match first.</div>
        ) : !hasRoster ? (
          <div style={{ color: "#64748b", fontSize: 14 }}>
            No roster loaded yet. Use <strong>Sync Scores Now</strong> (or link the match again) after the feed publishes squads / scorecard.
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
  borderRadius: 20,
  background: "#f8fbff",
  padding: 16,
};

const debugLineStyle: CSSProperties = {
  color: "#334155",
  marginBottom: 8,
  wordBreak: "break-word",
};

const buttonStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid #0f172a",
  background: "#0f172a",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
};

const buttonStyleSecondary: CSSProperties = {
  ...buttonStyle,
  background: "white",
  color: "#0f172a",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  color: "#475569",
  fontSize: 14,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #cbd5e1",
  borderRadius: 12,
  marginBottom: 12,
  boxSizing: "border-box",
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
  border: "1px solid #e2e8f0",
  borderRadius: 20,
  background: "#f8fafc",
  padding: 20,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const pickerPanelStyle: CSSProperties = {
  border: "1px solid #bfdbfe",
  borderRadius: 20,
  background: "#f0f9ff",
  padding: 20,
  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
};

const quotaBarContainerStyle: CSSProperties = {
  border: "1px solid #e2e8f0",
  borderRadius: 16,
  background: "white",
  padding: "12px 16px",
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
