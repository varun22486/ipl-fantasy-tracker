"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

type Competition = {
  id: number;
  name: string;
  player1_name: string;
  player2_name: string;
  players?: string[];
};

function compLabel(c: Competition): string {
  const players: string[] = Array.isArray(c.players) ? c.players : [c.player1_name, c.player2_name];
  if (players.length > 2) return `${players[0]} +${players.length - 1}`;
  return `${players[0]} vs ${players[1]}`;
}

type Props = {
  /** Full vertical list in sidebar (desktop) */
  variant: "sidebar" | "inline";
};

export default function CompetitionSwitcher({ variant }: Props) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const activeId = searchParams?.get("c") ? Number(searchParams.get("c")) : null;

  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [defaultLabel, setDefaultLabel] = useState("Varun vs Rahul");
  const [adding, setAdding] = useState(false);
  const [newPlayers, setNewPlayers] = useState<string[]>(["", ""]);
  const [saving, setSaving] = useState(false);

  const isSidebar = variant === "sidebar";

  useEffect(() => {
    fetch("/api/competitions")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setCompetitions(j.competitions);
      })
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        const s = j.settings ?? j;
        if (s.your_name || s.opponent_name) {
          setDefaultLabel(`${s.your_name ?? "Varun"} vs ${s.opponent_name ?? "Rahul"}`);
        }
      })
      .catch(() => {});
  }, []);

  function navigateTo(id: number | null) {
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
  }

  async function addCompetition() {
    const players = newPlayers.map((p) => p.trim()).filter(Boolean);
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
        setCompetitions((prev) => [...prev, j.competition]);
        setNewPlayers(["", ""]);
        setAdding(false);
        navigateTo(j.competition.id);
      }
    } finally {
      setSaving(false);
    }
  }

  function updatePlayer(idx: number, val: string) {
    setNewPlayers((prev) => prev.map((p, i) => (i === idx ? val : p)));
  }
  function addPlayerField() {
    setNewPlayers((prev) => [...prev, ""]);
  }
  function removePlayerField(idx: number) {
    if (newPlayers.length <= 2) return;
    setNewPlayers((prev) => prev.filter((_, i) => i !== idx));
  }

  async function deleteCompetition(id: number) {
    if (!confirm("Delete this competition? This will remove all player picks for this league.")) return;
    await fetch("/api/competitions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setCompetitions((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) navigateTo(null);
  }

  const selectBtn = (active: boolean, sidebar: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: sidebar ? 10 : 6,
    padding: sidebar ? "10px 12px" : "6px 11px",
    borderRadius: sidebar ? 10 : 999,
    border: active ? "1px solid rgba(147,197,253,0.45)" : "1px solid rgba(255,255,255,0.1)",
    background: active ? "rgba(59,130,246,0.22)" : "rgba(255,255,255,0.05)",
    color: active ? "#e0f2fe" : "#cbd5e1",
    cursor: "pointer",
    fontSize: sidebar ? 13 : 12,
    fontWeight: active ? 700 : 600,
    textAlign: "left" as const,
    transition: "background 0.12s, border-color 0.12s",
    flexShrink: sidebar ? undefined : 0,
    whiteSpace: "nowrap",
    width: sidebar ? "100%" : "auto",
    boxSizing: "border-box",
  });

  const addForm = (
    <div style={{ padding: isSidebar ? "10px 0 4px" : "8px 0 0", display: "grid", gap: 8 }}>
      {newPlayers.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6 }}>
          <input
            autoFocus={i === 0 && adding}
            value={p}
            onChange={(e) => updatePlayer(i, e.target.value)}
            placeholder={`Player ${i + 1}`}
            onKeyDown={(e) => e.key === "Enter" && i === newPlayers.length - 1 && void addCompetition()}
            style={inputStyle}
          />
          {newPlayers.length > 2 && (
            <button
              type="button"
              onClick={() => removePlayerField(i)}
              style={{ ...iconDangerBtn, flex: "0 0 32px" }}
              aria-label="Remove"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={addPlayerField} style={ghostBtn}>
        + Add another player
      </button>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => void addCompetition()}
          disabled={saving || newPlayers.filter((p) => p.trim()).length < 2}
          style={
            saving || newPlayers.filter((p) => p.trim()).length < 2 ? saveBtnDisabled : saveBtnStyle
          }
        >
          {saving ? "…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAdding(false);
            setNewPlayers(["", ""]);
          }}
          style={cancelBtnStyle}
        >
          Cancel
        </button>
      </div>
    </div>
  );

  if (isSidebar) {
    return (
      <div className="comp-switcher comp-switcher--sidebar">
        <p className="comp-switcher__heading">Competitions</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button type="button" onClick={() => navigateTo(null)} style={selectBtn(activeId === null, true)}>
            <span style={dotStyle("#86efac")} />
            <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{defaultLabel}</span>
          </button>
          {competitions.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
              <button type="button" onClick={() => navigateTo(c.id)} style={{ ...selectBtn(activeId === c.id, true), flex: 1 }}>
                <span style={dotStyle("#93c5fd")} />
                <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>{compLabel(c)}</span>
              </button>
              <button
                type="button"
                onClick={() => void deleteCompetition(c.id)}
                title="Delete competition"
                style={deleteSideBtn}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          {!adding ? (
            <button type="button" onClick={() => setAdding(true)} style={newLeagueBtn}>
              + New competition
            </button>
          ) : (
            addForm
          )}
        </div>
      </div>
    );
  }

  /* inline: horizontal pills (tablet header + mobile bar) */
  return (
    <div className="comp-switcher comp-switcher--inline">
      <div className="comp-switcher__scroll">
        <button type="button" onClick={() => navigateTo(null)} style={selectBtn(activeId === null, false)}>
          <span style={dotStyle("#86efac")} />
          {defaultLabel}
        </button>
        {competitions.map((c) => (
          <button key={c.id} type="button" onClick={() => navigateTo(c.id)} style={selectBtn(activeId === c.id, false)}>
            <span style={dotStyle("#93c5fd")} />
            {compLabel(c)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setAdding((a) => !a)}
          style={{
            ...selectBtn(false, false),
            borderStyle: "dashed",
            color: "#94a3b8",
          }}
        >
          {adding ? "Close" : "+ New"}
        </button>
      </div>
      {adding && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.1)" }}>{addForm}</div>
      )}
    </div>
  );
}

function dotStyle(color: string): CSSProperties {
  return { width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0 };
}

const inputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "#e2e8f0",
  fontSize: 13,
};
const saveBtnStyle: CSSProperties = {
  flex: 1,
  padding: "8px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
};
const saveBtnDisabled: CSSProperties = {
  ...saveBtnStyle,
  opacity: 0.45,
  cursor: "not-allowed",
};
const cancelBtnStyle: CSSProperties = {
  flex: 1,
  padding: "8px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
  fontSize: 13,
};
const ghostBtn: CSSProperties = {
  padding: "6px 0",
  border: "none",
  background: "transparent",
  color: "#64748b",
  cursor: "pointer",
  fontSize: 12,
  textAlign: "left" as const,
};
const newLeagueBtn: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px dashed rgba(255,255,255,0.2)",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  textAlign: "left" as const,
};
const deleteSideBtn: CSSProperties = {
  flexShrink: 0,
  width: 36,
  borderRadius: 10,
  border: "1px solid rgba(239,68,68,0.35)",
  background: "rgba(239,68,68,0.12)",
  color: "#f87171",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 700,
};
const iconDangerBtn: CSSProperties = {
  borderRadius: 8,
  border: "1px solid rgba(239,68,68,0.3)",
  background: "rgba(239,68,68,0.1)",
  color: "#f87171",
  cursor: "pointer",
  fontSize: 14,
};
