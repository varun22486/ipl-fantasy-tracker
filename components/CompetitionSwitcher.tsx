"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Competition = { id: number; name: string; player1_name: string; player2_name: string };

export default function CompetitionSwitcher() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const activeId = searchParams?.get("c") ? Number(searchParams.get("c")) : null;

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [defaultLabel, setDefaultLabel] = useState("Varun vs Rahul");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newPlayers, setNewPlayers] = useState<string[]>(["", ""]);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load named competitions
    fetch("/api/competitions").then(r => r.json()).then(j => {
      if (j.ok) setCompetitions(j.competitions);
    }).catch(() => {});
    // Load default pair names from settings
    fetch("/api/settings").then(r => r.json()).then(j => {
      const s = j.settings ?? j;
      if (s.your_name || s.opponent_name) {
        setDefaultLabel(`${s.your_name ?? "Varun"} vs ${s.opponent_name ?? "Rahul"}`);
      }
    }).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activeComp = activeId ? competitions.find(c => c.id === activeId) : null;

  function navigateTo(id: number | null) {
    // Store in cookie so it persists across all navigation (not just same-tab URL)
    if (typeof document !== "undefined") {
      if (id == null) {
        document.cookie = "active_comp=; path=/; max-age=0";
      } else {
        document.cookie = `active_comp=${id}; path=/; max-age=${60 * 60 * 24 * 30}`;
      }
    }
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (id == null) params.delete("c");
    else params.set("c", String(id));
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    setOpen(false);
  }

  async function addCompetition() {
    const players = newPlayers.map(p => p.trim()).filter(Boolean);
    if (players.length < 2) return;
    setSaving(true);
    try {
      const r = await fetch("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players }),
      });
      const j = await r.json();
      if (j.ok) {
        setCompetitions(prev => [...prev, j.competition]);
        setNewPlayers(["", ""]); setAdding(false);
        navigateTo(j.competition.id);
      }
    } finally {
      setSaving(false);
    }
  }

  function updatePlayer(idx: number, val: string) {
    setNewPlayers(prev => prev.map((p, i) => i === idx ? val : p));
  }
  function addPlayerField() {
    setNewPlayers(prev => [...prev, ""]);
  }
  function removePlayerField(idx: number) {
    if (newPlayers.length <= 2) return;
    setNewPlayers(prev => prev.filter((_, i) => i !== idx));
  }

  const activeCompPlayers: string[] = activeComp
    ? (Array.isArray(activeComp.players) ? activeComp.players : [activeComp.player1_name, activeComp.player2_name])
    : [];
  const label = activeComp
    ? (activeCompPlayers.length > 2
        ? `${activeCompPlayers[0]} +${activeCompPlayers.length - 1}`
        : `${activeCompPlayers[0]} vs ${activeCompPlayers[1]}`)
    : defaultLabel;

  async function deleteCompetition(id: number) {
    if (!confirm("Delete this competition? This will remove all player picks for this pair.")) return;
    await fetch("/api/competitions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setCompetitions(prev => prev.filter(c => c.id !== id));
    // If deleted the active one, switch back to default
    if (activeId === id) navigateTo(null);
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "6px 12px", borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.15)",
          background: open ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.07)",
          color: "#e2e8f0", cursor: "pointer", fontSize: 13, fontWeight: 600,
          transition: "background 0.12s",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: 999, background: activeComp ? "#93c5fd" : "#86efac", flexShrink: 0 }} />
        {label}
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 200,
          background: "#1e293b", border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 14, padding: 8, minWidth: 220,
          boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.1, textTransform: "uppercase", color: "#64748b", padding: "4px 10px 8px" }}>
            Competition
          </div>

          {/* Default (series_settings pair) */}
          <button onClick={() => navigateTo(null)} style={itemStyle(activeId === null)}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#86efac", flexShrink: 0 }} />
            <span style={{ flex: 1, textAlign: "left" }}>{defaultLabel}</span>
          </button>

          {competitions.map(c => {
            const players: string[] = Array.isArray(c.players) ? c.players : [c.player1_name, c.player2_name];
            const compLabel = players.length > 2 ? `${players[0]} + ${players.length - 1} others` : `${players[0]} vs ${players[1]}`;
            return (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button onClick={() => navigateTo(c.id)} style={{ ...itemStyle(activeId === c.id), flex: 1 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: "#93c5fd", flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: "left" }}>{compLabel}</span>
                {players.length > 2 && <span style={{ fontSize: 10, color: "#64748b" }}>{players.length}p</span>}
              </button>
              <button
                onClick={() => void deleteCompetition(c.id)}
                title="Delete this competition"
                style={{
                  flexShrink: 0, width: 26, height: 26, borderRadius: 7,
                  border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)",
                  color: "#f87171", cursor: "pointer", fontSize: 13, fontWeight: 700,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>
          );
          })}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 6, paddingTop: 6 }}>
            {!adding ? (
              <button onClick={() => setAdding(true)} style={addBtnStyle}>
                + Add pair
              </button>
            ) : (
              <div style={{ padding: "4px 6px", display: "grid", gap: 6 }}>
                {newPlayers.map((p, i) => (
                  <div key={i} style={{ display: "flex", gap: 4 }}>
                    <input
                      autoFocus={i === 0}
                      value={p}
                      onChange={e => updatePlayer(i, e.target.value)}
                      placeholder={`Player ${i + 1}`}
                      onKeyDown={e => e.key === "Enter" && i === newPlayers.length - 1 && void addCompetition()}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    {newPlayers.length > 2 && (
                      <button onClick={() => removePlayerField(i)} style={{ ...cancelBtnStyle, flex: "0 0 28px", padding: 0, fontSize: 14 }}>✕</button>
                    )}
                  </div>
                ))}
                <button onClick={addPlayerField} style={{ ...addBtnStyle, fontSize: 12, padding: "5px 0" }}>
                  + Add another player
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => void addCompetition()} disabled={saving || newPlayers.filter(p => p.trim()).length < 2} style={saveBtnStyle}>
                    {saving ? "…" : `Create (${newPlayers.filter(p => p.trim()).length} players)`}
                  </button>
                  <button onClick={() => { setAdding(false); setNewPlayers(["", ""]); }} style={cancelBtnStyle}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function itemStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%", display: "flex", alignItems: "center", gap: 8,
    padding: "8px 10px", borderRadius: 9, border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: active ? 700 : 500, textAlign: "left",
    background: active ? "rgba(59,130,246,0.2)" : "transparent",
    color: active ? "#93c5fd" : "#cbd5e1",
    transition: "background 0.1s",
  };
}

const inputStyle: React.CSSProperties = {
  padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)", color: "#e2e8f0", fontSize: 13, width: "100%",
};
const saveBtnStyle: React.CSSProperties = {
  flex: 1, padding: "7px", borderRadius: 8, border: "none",
  background: "#2563eb", color: "white", cursor: "pointer", fontWeight: 700, fontSize: 13,
};
const cancelBtnStyle: React.CSSProperties = {
  flex: 1, padding: "7px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.12)",
  background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13,
};
const addBtnStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 9, border: "none",
  background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 13,
  textAlign: "left",
};
