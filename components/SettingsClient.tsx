"use client";

import { useState, useEffect, type CSSProperties } from "react";

type Settings = {
  your_name?: string;
  opponent_name?: string;
  pts_run?: number;
  pts_wicket?: number;
  pts_catch?: number;
  pts_fifty?: number;
  pts_hundred?: number;
  pts_three_w?: number;
  pts_five_w?: number;
  pts_mom?: number;
};

const DEFAULTS = {
  pts_run: 1, pts_wicket: 20, pts_catch: 10,
  pts_fifty: 10, pts_hundred: 20,
  pts_three_w: 10, pts_five_w: 20, pts_mom: 10,
};

const SCORING_RULES = [
  { key: "pts_run",      label: "1 Run",           emoji: "🏏" },
  { key: "pts_wicket",   label: "1 Wicket",         emoji: "🎯" },
  { key: "pts_catch",    label: "1 Catch",          emoji: "🙌" },
  { key: "pts_fifty",    label: "50-run bonus",     emoji: "⭐" },
  { key: "pts_hundred",  label: "100-run bonus",    emoji: "💯" },
  { key: "pts_three_w",  label: "3-wicket bonus",   emoji: "🔥" },
  { key: "pts_five_w",   label: "5-wicket bonus",   emoji: "🔥🔥" },
  { key: "pts_mom",      label: "Man of the Match", emoji: "🏆" },
] as const;

export default function SettingsClient({ settings }: { settings: Settings }) {
  const [yourName, setYourName] = useState(settings.your_name ?? "Varun");
  const [opponentName, setOpponentName] = useState(settings.opponent_name ?? "Rahul");
  const [pts, setPts] = useState<Record<string, number>>({
    pts_run:     settings.pts_run     ?? DEFAULTS.pts_run,
    pts_wicket:  settings.pts_wicket  ?? DEFAULTS.pts_wicket,
    pts_catch:   settings.pts_catch   ?? DEFAULTS.pts_catch,
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

      {/* Competitions */}
      <CompetitionsPanel />
    </div>
  );
}

type Competition = { id: number; name: string; player1_name: string; player2_name: string };

function CompetitionsPanel() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [newP1, setNewP1] = useState("");
  const [newP2, setNewP2] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/competitions").then(r => r.json()).then(j => {
      if (j.ok) setCompetitions(j.competitions);
    });
  }, []);

  async function add() {
    if (!newP1.trim() || !newP2.trim()) return;
    setSaving(true); setMsg("");
    try {
      const r = await fetch("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1_name: newP1.trim(), player2_name: newP2.trim() }),
      });
      const j = await r.json();
      if (j.ok) { setCompetitions(prev => [...prev, j.competition]); setNewP1(""); setNewP2(""); setMsg("Added!"); }
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
      <h2 style={{ ...sectionTitle, marginBottom: 4 }}>🏆 Competitions (pairs)</h2>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>
        Each competition is a head-to-head pair. Switch between them using the selector at the top of the sidebar.
        Your original {'"'}Default{'"'} competition (from Player Names above) is always available.
      </div>

      {competitions.length === 0 ? (
        <div style={{ fontSize: 13, color: "#94a3b8", padding: "12px 0" }}>No extra competitions yet.</div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {competitions.map(c => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.player1_name}</span>
                <span style={{ color: "#94a3b8", margin: "0 8px" }}>vs</span>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{c.player2_name}</span>
              </div>
              <span style={{ fontSize: 11, color: "#94a3b8", marginRight: 8 }}>?c={c.id}</span>
              <button
                onClick={() => void remove(c.id)}
                style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #fecaca", background: "#fff1f2", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 700 }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#475569" }}>Add a new pair</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input value={newP1} onChange={e => setNewP1(e.target.value)} placeholder="Player 1 name" style={input} />
          <input value={newP2} onChange={e => setNewP2(e.target.value)} placeholder="Player 2 name" style={input} onKeyDown={e => e.key === "Enter" && void add()} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => void add()} disabled={saving || !newP1.trim() || !newP2.trim()} style={btnPrimary}>
            {saving ? "Adding…" : "Add pair"}
          </button>
          {msg && <span style={{ fontSize: 13, color: msg === "Added!" ? "#16a34a" : "#dc2626" }}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}

const panel: CSSProperties = { background: "white", border: "1px solid #e2e8f0", borderRadius: 20, padding: 24 };
const sectionTitle: CSSProperties = { margin: "0 0 16px", fontSize: 17, fontWeight: 800, color: "#0f172a" };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const labelText: CSSProperties = { fontSize: 13, fontWeight: 600, color: "#475569" };
const input: CSSProperties = { padding: "9px 12px", border: "1px solid #cbd5e1", borderRadius: 10, fontSize: 14, width: "100%", boxSizing: "border-box" };
const btnPrimary: CSSProperties = { padding: "11px 22px", borderRadius: 12, border: "1px solid #0f172a", background: "#0f172a", color: "white", cursor: "pointer", fontWeight: 700, fontSize: 15 };
const btnSecondary: CSSProperties = { ...btnPrimary, background: "white", color: "#0f172a", fontSize: 13, padding: "7px 14px" };
const nudgeBtn: CSSProperties = { width: 30, height: 30, borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer", fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" };
