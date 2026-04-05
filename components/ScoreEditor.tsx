"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { FantasyPlayer } from "@/lib/scoring";

type Field = "runs" | "wickets" | "catches" | "runouts" | "stumpings" | "fifty_bonus" | "hundred_bonus" | "three_w_bonus" | "five_w_bonus" | "mom_bonus";

const FIELDS: { key: Field; label: string }[] = [
  { key: "runs",          label: "Runs" },
  { key: "wickets",       label: "Wickets" },
  { key: "catches",       label: "Catches (CT)" },
  { key: "runouts",       label: "Run-outs (RO)" },
  { key: "stumpings",     label: "Stumpings (ST)" },
  { key: "fifty_bonus",   label: "50-run bonus (0 or 1)" },
  { key: "hundred_bonus", label: "100-run bonus (0 or 1)" },
  { key: "three_w_bonus", label: "3-wkt bonus (0 or 1)" },
  { key: "five_w_bonus",  label: "5-wkt bonus (0 or 1)" },
  { key: "mom_bonus",     label: "MOM bonus (0 or 1)" },
];

function statsFromPlayer(player: FantasyPlayer): Record<Field, number> {
  return {
    runs:          player.runs,
    wickets:       player.wickets,
    catches:       player.catches,
    runouts:       player.runouts ?? 0,
    stumpings:     player.stumpings ?? 0,
    fifty_bonus:   player.fifty_bonus,
    hundred_bonus: player.hundred_bonus,
    three_w_bonus: player.three_w_bonus,
    five_w_bonus:  player.five_w_bonus,
    mom_bonus:     player.mom_bonus,
  };
}

export default function ScoreEditor({ player }: { player: FantasyPlayer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<Field, number>>(() => statsFromPlayer(player));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  function openModal() {
    setValues(statsFromPlayer(player));
    setMsg("");
    setOpen(true);
  }

  async function save() {
    const pid = player.id;
    if (pid == null || !Number.isFinite(Number(pid))) {
      setMsg("Missing player id — reload the page.");
      return;
    }
    setSaving(true); setMsg("");
    try {
      const res = await fetch("/api/correct-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: pid, ...values }),
      });
      const json = await res.json();
      if (json.ok) {
        setMsg("Saved!");
        setTimeout(() => {
          setOpen(false);
          router.refresh();
        }, 500);
      } else {
        setMsg(json.error ?? "Error saving.");
      }
    } catch { setMsg("Network error."); }
    setSaving(false);
  }

  function set(key: Field, val: string) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 0) setValues((v) => ({ ...v, [key]: n }));
  }

  return (
    <>
      <button type="button" onClick={openModal} style={editBtn} title="Manually correct scores">
        ✏️
      </button>

      {open && (
        <div style={overlay} onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div style={modal}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>Edit: {player.name}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>Correct API mistakes manually</div>
              </div>
              <button onClick={() => setOpen(false)} style={closeBtn}>✕</button>
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
              {FIELDS.map(({ key, label }) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <label style={{ fontSize: 13, color: "#475569", fontWeight: 500 }}>{label}</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button type="button" style={nudge} onClick={() => set(key, String(values[key] - 1))} disabled={values[key] <= 0}>−</button>
                    <input
                      type="number"
                      min={0}
                      value={values[key]}
                      onChange={(e) => set(key, e.target.value)}
                      style={numInput}
                    />
                    <button type="button" style={nudge} onClick={() => set(key, String(values[key] + 1))}>+</button>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button onClick={save} disabled={saving} style={saveBtn}>
                {saving ? "Saving…" : "Save Corrections"}
              </button>
              <button onClick={() => setOpen(false)} style={cancelBtn}>Cancel</button>
              {msg && <span style={{ fontSize: 13, color: msg === "Saved!" ? "#16a34a" : "#dc2626", fontWeight: 600 }}>{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const editBtn: CSSProperties = { background: "none", border: "1px solid #e2e8f0", borderRadius: 7, cursor: "pointer", padding: "3px 7px", fontSize: 14, color: "#64748b" };
const overlay: CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 };
const modal: CSSProperties = {
  background: "var(--surface)",
  borderRadius: 22,
  padding: 26,
  width: "100%",
  maxWidth: 400,
  boxShadow: "0 24px 64px rgba(15,23,42,0.18), var(--shadow-md)",
  border: "1px solid var(--border)",
};
const closeBtn: CSSProperties = { background: "none", border: "none", fontSize: 18, cursor: "pointer", color: "#94a3b8", padding: "2px 6px", borderRadius: 6 };
const numInput: CSSProperties = { width: 60, padding: "5px 8px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, textAlign: "center" };
const nudge: CSSProperties = { width: 28, height: 28, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontWeight: 700, fontSize: 15 };
const saveBtn: CSSProperties = {
  padding: "10px 20px",
  borderRadius: 14,
  border: "none",
  background: "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
  boxShadow: "0 2px 12px rgba(37,99,235,0.3)",
};
const cancelBtn: CSSProperties = {
  padding: "10px 20px",
  borderRadius: 14,
  border: "1px solid var(--border-strong)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 14,
  boxShadow: "var(--shadow-xs)",
};
