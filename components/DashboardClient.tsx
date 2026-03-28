"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";

type Player = {
  name: string;
  trump: boolean;
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
  return Array.from({ length: 4 }, () => ({ name: "", trump: false }));
}

function withFallback(players: Player[]) {
  const next = emptyPlayers();
  for (let i = 0; i < Math.min(players.length, 4); i += 1) {
    next[i] = players[i];
  }
  if (!next.some((p) => p.trump) && next[0]) {
    next[0].trump = true;
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
  const [activeSlot, setActiveSlot] = useState<{ side: "mine" | "theirs"; index: number } | null>(null);
  const [linkChoices, setLinkChoices] = useState<MatchChoice[] | null>(null);
  const [pickedLinkId, setPickedLinkId] = useState("");
  const [linkDateHint, setLinkDateHint] = useState("");

  useEffect(() => {
    const interval = window.setInterval(async () => {
      try {
        const res = await fetch("/api/refresh", { method: "POST" });
        const json = await res.json();
        setDebugInfo(json);
        if (json.ok && !json.skipped) {
          window.location.reload();
        }
      } catch {}
    }, 60000);

    return () => window.clearInterval(interval);
  }, []);

  const canSave = useMemo(() => {
    const hasFourMine = mine.every((p) => p.name.trim());
    const hasFourTheirs = theirs.every((p) => p.name.trim());
    const oneTrumpMine = mine.filter((p) => p.trump).length === 1;
    const oneTrumpTheirs = theirs.filter((p) => p.trump).length === 1;
    return hasFourMine && hasFourTheirs && oneTrumpMine && oneTrumpTheirs;
  }, [mine, theirs]);

  async function submitSeedLink(externalMatchId: string) {
    if (!externalMatchId) {
      setMessage("Pick a match first.");
      return;
    }
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
      setMessage(json.ok ? "Match linked. Refreshing…" : json.error || "Could not link match.");
      if (json.ok) window.location.reload();
    } catch {
      setMessage("Network error while linking.");
    }
    setSyncing(false);
  }

  async function startLinkTodaysMatch() {
    setSyncing(true);
    setMessage("Loading today's IPL fixtures (India date)…");
    setLinkChoices(null);
    try {
      const res = await fetch("/api/matches/today");
      const json = await res.json();
      setDebugInfo(json);
      if (!json.ok) {
        setMessage(json.error || "Could not load today's matches.");
        setSyncing(false);
        return;
      }
      setLinkDateHint(typeof json.date === "string" ? json.date : "");
      const choices: MatchChoice[] = Array.isArray(json.choices) ? json.choices : [];
      if (choices.length === 0) {
        setMessage("No IPL matches listed for today. Try again later or check your cricket API quota.");
        setSyncing(false);
        return;
      }
      if (choices.length === 1) {
        const id = choices[0].externalMatchId || "";
        await submitSeedLink(id);
        return;
      }
      setLinkChoices(choices);
      setPickedLinkId(choices[0].externalMatchId || "");
      setMessage(`${choices.length} matches today — choose one below.`);
    } catch {
      setMessage("Network error loading today's matches.");
    }
    setSyncing(false);
  }

  async function refreshNow() {
    setSyncing(true);
    setMessage("Refreshing from cricket source...");
    const res = await fetch("/api/refresh", { method: "POST" });
    const json = await res.json();
    setSyncing(false);
    setDebugInfo(json);

    if (json.ok) {
      setMessage(json.reason || json.message || (json.skipped ? "Using cached data." : "Dashboard updated."));
      if (!json.skipped) {
        window.setTimeout(() => window.location.reload(), 1200);
      }
    } else {
      setMessage(json.error || "Refresh failed.");
    }
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

  function updateName(side: "mine" | "theirs", index: number, value: string) {
    const setter = side === "mine" ? setMine : setTheirs;
    setter((prev) => prev.map((player, i) => (i === index ? { ...player, name: value } : player)));
  }

  function updateTrump(side: "mine" | "theirs", index: number) {
    const setter = side === "mine" ? setMine : setTheirs;
    setter((prev) => prev.map((player, i) => ({ ...player, trump: i === index })));
  }

  function togglePickSlot(side: "mine" | "theirs", index: number) {
    setActiveSlot((cur) => (cur?.side === side && cur?.index === index ? null : { side, index }));
  }

  function applyRosterName(name: string) {
    if (!activeSlot) {
      setMessage("Choose Pick on a row, then tap a player name below.");
      return;
    }
    updateName(activeSlot.side, activeSlot.index, name);
  }

  const hasRoster = rosterNames.length > 0 || squads.some((t) => t.players.length > 0);

  return (
    <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button onClick={() => void startLinkTodaysMatch()} disabled={syncing} style={buttonStyle}>
          {syncing ? "Working..." : "Link Today's Match"}
        </button>
        <button onClick={refreshNow} disabled={syncing} style={buttonStyleSecondary}>
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
            {linkChoices.map((c) => (
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
              onClick={() => {
                setLinkChoices(null);
                setMessage("");
              }}
              disabled={syncing}
              style={buttonStyleSecondary}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div style={rosterPanelStyle}>
        <h3 style={{ marginTop: 0 }}>Players in this match</h3>
        <div style={{ color: "#475569", marginBottom: 12, fontSize: 14 }}>
          Names come from the cricket feed so they match live stats. Click <strong>Pick</strong> on a lineup row, then tap a name to fill that slot.
        </div>
        {!hasLinkedMatch ? (
          <div style={{ color: "#64748b", fontSize: 14 }}>Link today&apos;s IPL match first.</div>
        ) : !hasRoster ? (
          <div style={{ color: "#64748b", fontSize: 14 }}>
            No roster loaded yet. Use <strong>Sync Scores Now</strong> (or link the match again) after the feed publishes squads / scorecard.
          </div>
        ) : squads.length > 0 ? (
          <div style={{ display: "grid", gap: 16 }}>
            {squads.map((team) => (
              <div key={team.teamName}>
                <div style={{ fontWeight: 700, marginBottom: 8, color: "#334155" }}>{team.teamName}</div>
                <div style={chipGridStyle}>
                  {team.players.map((name) => (
                    <button key={`${team.teamName}-${name}`} type="button" style={chipStyle} onClick={() => applyRosterName(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={chipGridStyle}>
            {rosterNames.map((name) => (
              <button key={name} type="button" style={chipStyle} onClick={() => applyRosterName(name)}>
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={panelStyle}>
        <h3 style={{ marginTop: 0 }}>Set the 4-player lineups</h3>
        <div style={{ color: "#475569", marginBottom: 16 }}>
          Enter 4 players for each side and mark exactly 1 trump. The dashboard will keep syncing those names against the live cricket feed.
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Opponent name</label>
          <input value={rival} onChange={(e) => setRival(e.target.value)} style={inputStyle} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
          <div>
            <div style={sectionTitleStyle}>Your 4 players</div>
            {mine.map((player, index) => (
              <div
                key={`mine-${index}`}
                style={{
                  ...rowStyle,
                  ...(activeSlot?.side === "mine" && activeSlot?.index === index ? activeRowStyle : {}),
                }}
              >
                <button type="button" onClick={() => togglePickSlot("mine", index)} style={pickSlotStyle(activeSlot?.side === "mine" && activeSlot?.index === index)}>
                  Pick
                </button>
                <input
                  value={player.name}
                  onChange={(e) => updateName("mine", index, e.target.value)}
                  placeholder={`Player ${index + 1}`}
                  style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                />
                <label style={checkboxLabelStyle}>
                  <input type="radio" checked={player.trump} onChange={() => updateTrump("mine", index)} /> Trump
                </label>
              </div>
            ))}
          </div>

          <div>
            <div style={sectionTitleStyle}>{rival || "Opponent"}'s 4 players</div>
            {theirs.map((player, index) => (
              <div
                key={`their-${index}`}
                style={{
                  ...rowStyle,
                  ...(activeSlot?.side === "theirs" && activeSlot?.index === index ? activeRowStyle : {}),
                }}
              >
                <button type="button" onClick={() => togglePickSlot("theirs", index)} style={pickSlotStyle(activeSlot?.side === "theirs" && activeSlot?.index === index)}>
                  Pick
                </button>
                <input
                  value={player.name}
                  onChange={(e) => updateName("theirs", index, e.target.value)}
                  placeholder={`Player ${index + 1}`}
                  style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                />
                <label style={checkboxLabelStyle}>
                  <input type="radio" checked={player.trump} onChange={() => updateTrump("theirs", index)} /> Trump
                </label>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={saveLineup} disabled={!canSave || saving} style={buttonStyle}>
            {saving ? "Saving..." : "Save Lineups"}
          </button>
          <span style={{ color: "#475569" }}>{message}</span>
        </div>
      </div>

      <DebugPanel info={debugInfo} />
    </div>
  );
}

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
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 10,
};

const checkboxLabelStyle: CSSProperties = {
  whiteSpace: "nowrap",
  display: "flex",
  alignItems: "center",
  gap: 6,
  color: "#334155",
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

const activeRowStyle: CSSProperties = {
  background: "#eff6ff",
  marginLeft: -8,
  marginRight: -8,
  paddingLeft: 8,
  paddingRight: 8,
  borderRadius: 12,
};

function pickSlotStyle(active: boolean): CSSProperties {
  return {
    flexShrink: 0,
    padding: "8px 10px",
    borderRadius: 10,
    border: active ? "2px solid #2563eb" : "1px solid #cbd5e1",
    background: active ? "#dbeafe" : "white",
    color: "#0f172a",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  };
}
