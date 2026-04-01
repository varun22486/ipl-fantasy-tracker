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
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newP1, setNewP1] = useState("");
  const [newP2, setNewP2] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/competitions").then(r => r.json()).then(j => {
      if (j.ok) setCompetitions(j.competitions);
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
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (id == null) params.delete("c");
    else params.set("c", String(id));
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
    setOpen(false);
  }

  async function addCompetition() {
    if (!newP1.trim() || !newP2.trim()) return;
    setSaving(true);
    try {
      const r = await fetch("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player1_name: newP1.trim(), player2_name: newP2.trim() }),
      });
      const j = await r.json();
      if (j.ok) {
        setCompetitions(prev => [...prev, j.competition]);
        setNewP1(""); setNewP2(""); setAdding(false);
        navigateTo(j.competition.id);
      }
    } finally {
      setSaving(false);
    }
  }

  const label = activeComp
    ? `${activeComp.player1_name} vs ${activeComp.player2_name}`
    : "Default";

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

          {/* Default (series_settings) */}
          <button onClick={() => navigateTo(null)} style={itemStyle(activeId === null)}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#86efac" }} />
            Default
            <span style={{ fontSize: 11, color: "#64748b", marginLeft: "auto" }}>original</span>
          </button>

          {competitions.map(c => (
            <button key={c.id} onClick={() => navigateTo(c.id)} style={itemStyle(activeId === c.id)}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: "#93c5fd" }} />
              {c.player1_name} vs {c.player2_name}
            </button>
          ))}

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginTop: 6, paddingTop: 6 }}>
            {!adding ? (
              <button onClick={() => setAdding(true)} style={addBtnStyle}>
                + Add pair
              </button>
            ) : (
              <div style={{ padding: "4px 6px", display: "grid", gap: 6 }}>
                <input
                  autoFocus
                  value={newP1}
                  onChange={e => setNewP1(e.target.value)}
                  placeholder="Player 1 name"
                  style={inputStyle}
                />
                <input
                  value={newP2}
                  onChange={e => setNewP2(e.target.value)}
                  placeholder="Player 2 name"
                  onKeyDown={e => e.key === "Enter" && void addCompetition()}
                  style={inputStyle}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => void addCompetition()} disabled={saving || !newP1.trim() || !newP2.trim()} style={saveBtnStyle}>
                    {saving ? "…" : "Add"}
                  </button>
                  <button onClick={() => { setAdding(false); setNewP1(""); setNewP2(""); }} style={cancelBtnStyle}>
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
