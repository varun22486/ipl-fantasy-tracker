"use client";

import { useState, useEffect, type CSSProperties } from "react";

type Settings = {
  your_name?: string;
  opponent_name?: string;
  pts_run?: number;
  pts_wicket?: number;
  pts_catch?: number;
  pts_runout?: number;
  pts_stump?: number;
  pts_fifty?: number;
  pts_hundred?: number;
  pts_three_w?: number;
  pts_five_w?: number;
  pts_mom?: number;
};

const DEFAULTS = {
  pts_run: 1, pts_wicket: 20, pts_catch: 10, pts_runout: 10, pts_stump: 10,
  pts_fifty: 10, pts_hundred: 20,
  pts_three_w: 10, pts_five_w: 20, pts_mom: 10,
};

const SCORING_RULES = [
  { key: "pts_run",      label: "1 Run",           emoji: "🏏" },
  { key: "pts_wicket",   label: "1 Wicket",         emoji: "🎯" },
  { key: "pts_catch",    label: "1 Catch",          emoji: "🙌" },
  { key: "pts_runout",   label: "Run-out (fielder)", emoji: "🎯" },
  { key: "pts_stump",    label: "Stumping (WK)",    emoji: "🧤" },
  { key: "pts_fifty",    label: "50-run bonus",     emoji: "⭐" },
  { key: "pts_hundred",  label: "100-run bonus",    emoji: "💯" },
  { key: "pts_three_w",  label: "3-wicket bonus",   emoji: "🔥" },
  { key: "pts_five_w",   label: "5-wicket bonus",   emoji: "🔥🔥" },
  { key: "pts_mom",      label: "Man of the Match", emoji: "🏆" },
] as const;

type CronLastRunSummary = {
  finishedLabel: string;
  ok: boolean;
  linkedCount: number | null;
  errorCount: number | null;
  istDate: string | null;
  errorMessage: string | null;
};

export default function SettingsClient({
  settings,
  cronLastRun,
}: {
  settings: Settings;
  cronLastRun?: CronLastRunSummary | null;
}) {
  const [yourName, setYourName] = useState(settings.your_name ?? "Varun");
  const [opponentName, setOpponentName] = useState(settings.opponent_name ?? "Rahul");
  const [pts, setPts] = useState<Record<string, number>>({
    pts_run:     settings.pts_run     ?? DEFAULTS.pts_run,
    pts_wicket:  settings.pts_wicket  ?? DEFAULTS.pts_wicket,
    pts_catch:   settings.pts_catch   ?? DEFAULTS.pts_catch,
    pts_runout:  settings.pts_runout  ?? DEFAULTS.pts_runout,
    pts_stump:   settings.pts_stump   ?? DEFAULTS.pts_stump,
    pts_fifty:   settings.pts_fifty   ?? DEFAULTS.pts_fifty,
    pts_hundred: settings.pts_hundred ?? DEFAULTS.pts_hundred,
    pts_three_w: settings.pts_three_w ?? DEFAULTS.pts_three_w,
    pts_five_w:  settings.pts_five_w  ?? DEFAULTS.pts_five_w,
    pts_mom:     settings.pts_mom     ?? DEFAULTS.pts_mom,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function save() {
    setSaving(true); setMessage(""); setIsError(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ your_name: yourName.trim(), opponent_name: opponentName.trim(), ...pts }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessage("Settings saved! Changes apply from next page load.");
      } else {
        setIsError(true);
        setMessage(json.error ?? "Could not save.");
      }
    } catch {
      setIsError(true);
      setMessage("Network error.");
    }
    setSaving(false);
  }

  function updatePts(key: string, val: string) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 0) setPts((p) => ({ ...p, [key]: n }));
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>

      {/* Names */}
      <div style={panel}>
        <h2 style={sectionTitle}>👤 Player Names</h2>
        <div style={{ display: "grid", gap: 14 }}>
          <label style={labelStyle}>
            <span style={labelText}>Your name</span>
            <input value={yourName} onChange={(e) => setYourName(e.target.value)} style={input} placeholder="e.g. Varun" />
          </label>
          <label style={labelStyle}>
            <span style={labelText}>Opponent&apos;s name</span>
            <input value={opponentName} onChange={(e) => setOpponentName(e.target.value)} style={input} placeholder="e.g. Rahul" />
          </label>
        </div>
      </div>

      {/* Scoring rules */}
      <div style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
          <div>
            <h2 style={{ ...sectionTitle, marginBottom: 2 }}>⚡ Scoring Rules</h2>
            <div style={{ fontSize: 13, color: "#64748b" }}>Points awarded per event. Captain picks up ×2 on their total.</div>
          </div>
          <button
            type="button"
            onClick={() => setPts({ ...DEFAULTS })}
            style={btnSecondary}
          >
            Reset to defaults
          </button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {SCORING_RULES.map(({ key, label, emoji }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20, width: 28, textAlign: "center" }}>{emoji}</span>
                <span style={{ fontWeight: 500, fontSize: 14, color: "#0f172a" }}>{label}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button type="button" onClick={() => updatePts(key, String((pts[key] ?? 0) - 1))} style={nudgeBtn} disabled={(pts[key] ?? 0) <= 0}>−</button>
                <input
                  type="number"
                  min={0}
                  value={pts[key] ?? 0}
                  onChange={(e) => updatePts(key, e.target.value)}
                  style={{ ...input, width: 64, textAlign: "center", padding: "6px 8px" }}
                />
                <button type="button" onClick={() => updatePts(key, String((pts[key] ?? 0) + 1))} style={nudgeBtn}>+</button>
                <span style={{ fontSize: 13, color: "#94a3b8", minWidth: 30 }}>pts</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Save */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <button onClick={save} disabled={saving} style={btnPrimary}>
          {saving ? "Saving…" : "Save Settings"}
        </button>
        {message && (
          <span style={{ fontSize: 14, color: isError ? "#dc2626" : "#16a34a", fontWeight: 500 }}>
            {isError ? "✗" : "✓"} {message}
          </span>
        )}
      </div>

      {/* Note about scoring rules */}
      <div style={{ padding: "12px 16px", borderRadius: 12, background: "#fffbeb", border: "1px solid #fde68a", fontSize: 13, color: "#92400e" }}>
        ⚠️ <strong>Note:</strong> Changing scoring rules updates future calculations but does <em>not</em> retroactively re-sync past match stats from the API — existing raw stats (runs, wickets, catches) will be re-scored automatically with the new values.
      </div>

      <SyncAndDataPanel cronLastRun={cronLastRun ?? null} />

      {/* Competitions */}
      <CompetitionsPanel />
    </div>
  );
}

type Competition = { id: number; name: string; player1_name: string; player2_name: string };

function SyncAndDataPanel({ cronLastRun }: { cronLastRun: CronLastRunSummary | null }) {
  return (
    <div className="settings-sync-panel">
      <h2 className="settings-sync-panel__title">Sync &amp; data</h2>
      <ul className="settings-sync-panel__list">
        <li>
          <strong>Live scores</strong> come from your configured cricket API. Each <strong>Sync scores</strong> action uses API
          credits (see the quota bar on the home / match screens). If keys are rate-limited or the daily quota is used, wait
          for the time shown in the error message (often ~15 minutes or until the next UTC day).
        </li>
        <li>
          <strong>Link match</strong> loads today&apos;s IPL fixtures from the feed, then saves the fixture you pick. A scheduled
          job can auto-link today&apos;s IPL rows if you deploy with <code className="settings-sync-panel__code">vercel.json</code>{" "}
          cron and set <code className="settings-sync-panel__code">CRON_SECRET</code> (see Debug → API diagnostics).
        </li>
        <li>
          Optional env <code className="settings-sync-panel__code">CRICKET_HTTP_TIMEOUT_MS</code> (8000–120000, default 28000)
          caps how long each provider HTTP call may run before timing out.
        </li>
      </ul>
      <div className="settings-sync-panel__cron" role="status">
        <span className="settings-sync-panel__cron-label">Last IPL auto-link (cron)</span>
        {cronLastRun == null ? (
          <span className="settings-sync-panel__cron-value settings-sync-panel__cron-value--muted">
            No run recorded yet — run the migration for <code>cron_job_runs</code> if you use scheduled auto-link.
          </span>
        ) : (
          <>
            <span className="settings-sync-panel__cron-value">
              {cronLastRun.finishedLabel}
              {cronLastRun.ok ? (
                <>
                  {" "}
                  · linked {cronLastRun.linkedCount ?? "—"}
                  {cronLastRun.errorCount != null && cronLastRun.errorCount > 0
                    ? ` · ${cronLastRun.errorCount} error(s)`
                    : ""}
                  {cronLastRun.istDate ? ` · IST ${cronLastRun.istDate}` : ""}
                </>
              ) : (
                <> · failed{cronLastRun.errorMessage ? `: ${cronLastRun.errorMessage}` : ""}</>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function CompetitionsPanel() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [newPlayers, setNewPlayers] = useState<string[]>(["", ""]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/competitions").then(r => r.json()).then(j => {
      if (j.ok) setCompetitions(j.competitions);
    });
  }, []);

  function updatePlayer(idx: number, val: string) {
    setNewPlayers(prev => prev.map((p, i) => i === idx ? val : p));
  }

  async function add() {
    const players = newPlayers.map(p => p.trim()).filter(Boolean);
    if (players.length < 2) return;
    setSaving(true); setMsg("");
    try {
      const r = await fetch("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players }),
      });
      const j = await r.json();
      if (j.ok) { setCompetitions(prev => [...prev, j.competition]); setNewPlayers(["", ""]); setMsg("Created!"); }
      else setMsg(j.error || "Failed");
    } finally { setSaving(false); }
  }

  async function remove(id: number) {
    if (!confirm("Delete this competition and all its player picks?")) return;
    await fetch("/api/competitions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setCompetitions(prev => prev.filter(c => c.id !== id));
  }

  return (
    <div style={panel}>
      <h2 style={{ ...sectionTitle, marginBottom: 4 }}>🏆 Competitions</h2>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
        Each competition is a group of 2 or more players tracking their fantasy picks together.
        Switch between them using the selector at the top of the sidebar.
        Your original {'"'}Default{'"'} competition is always available.
      </div>

      {competitions.length === 0 ? (
        <div style={{ fontSize: 13, color: "#94a3b8", padding: "12px 0" }}>No extra competitions yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {competitions.map(c => {
            const players: string[] = Array.isArray(c.players) ? c.players : [c.player1_name, c.player2_name];
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div style={{ flex: 1 }}>
                  {players.map((p, i) => (
                    <span key={i}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{p}</span>
                      {i < players.length - 1 && <span style={{ color: "#94a3b8", margin: "0 6px" }}>·</span>}
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>{players.length} players</span>
                </div>
                <button
                  onClick={() => void remove(c.id)}
                  style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Create new competition</div>
        <div style={{ display: "grid", gap: 8 }}>
          {newPlayers.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input value={p} onChange={e => updatePlayer(i, e.target.value)} placeholder={`Player ${i + 1} name`} style={{ ...input, flex: 1 }} />
              {newPlayers.length > 2 && (
                <button onClick={() => setNewPlayers(prev => prev.filter((_, j) => j !== i))} style={{ padding: "0 10px", border: "1px solid #fecaca", background: "#fff1f2", color: "#ef4444", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>✕</button>
              )}
            </div>
          ))}
          <button onClick={() => setNewPlayers(prev => [...prev, ""])} style={{ ...btnSecondary, justifySelf: "start", fontSize: 13 }}>
            + Add another player
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => void add()} disabled={saving || newPlayers.filter(p => p.trim()).length < 2} style={btnPrimary}>
            {saving ? "Creating…" : `Create competition (${newPlayers.filter(p => p.trim()).length} players)`}
          </button>
          {msg && <span style={{ fontSize: 13, color: msg === "Created!" ? "#16a34a" : "#dc2626" }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

const panel: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 20,
  padding: 26,
  boxShadow: "var(--shadow-card)",
};
const sectionTitle: CSSProperties = { margin: "0 0 16px", fontSize: 18, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.02em" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const labelText: CSSProperties = { fontSize: 13, fontWeight: 600, color: "#475569" };
const input: CSSProperties = { padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 14, width: "100%", boxSizing: "border-box" };
const btnPrimary: CSSProperties = {
  padding: "12px 24px",
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 15,
  boxShadow: "0 2px 16px rgba(37,99,235,0.33)",
};
const btnSecondary: CSSProperties = {
  padding: "8px 16px",
  borderRadius: 12,
  border: "1px solid var(--border-strong)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 600,
  fontSize: 13,
  boxShadow: "var(--shadow-xs)",
};
const nudgeBtn: CSSProperties = { width: 30, height: 30, borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" };
