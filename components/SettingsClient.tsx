"use client";

import { useState, type CSSProperties } from "react";

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
