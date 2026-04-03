"use client";

import React, { useState } from "react";
import type { FantasyPlayer } from "@/lib/scoring";

type Row = {
  id: number;
  name: string;
  side: string;
  captain: boolean;
  runs: number;
  wickets: number;
  catches: number;
  runouts: number;
  stumpings: number;
  fifty_bonus: number;
  hundred_bonus: number;
  three_w_bonus: number;
  five_w_bonus: number;
  mom_bonus: number;
};

function toRow(p: FantasyPlayer): Row {
  return {
    id: p.id, name: p.name, side: p.side, captain: p.captain,
    runs: p.runs, wickets: p.wickets, catches: p.catches, runouts: p.runouts ?? 0, stumpings: p.stumpings ?? 0,
    fifty_bonus: p.fifty_bonus, hundred_bonus: p.hundred_bonus,
    three_w_bonus: p.three_w_bonus, five_w_bonus: p.five_w_bonus, mom_bonus: p.mom_bonus,
  };
}

function Num({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} style={nudge}>−</button>
      <input
        type="number" min={0} value={value}
        onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n) && n >= 0) onChange(n); }}
        style={numInput}
      />
      <button type="button" onClick={() => onChange(value + 1)} style={nudge}>+</button>
    </div>
  );
}

function BonusToggle({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const on = value > 0;
  return (
    <button
      type="button"
      onClick={() => onChange(on ? 0 : 1)}
      style={{
        padding: "3px 8px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
        border: on ? "1px solid #16a34a" : "1px solid #e2e8f0",
        background: on ? "#dcfce7" : "white",
        color: on ? "#15803d" : "#94a3b8",
      }}
    >
      {label}
    </button>
  );
}

type Status = "idle" | "saving" | "saved" | "error";

function PlayerEditRow({ row, onChange }: { row: Row; onChange: (updated: Row) => void }) {
  const [status, setStatus] = useState<Status>("idle");

  async function save() {
    setStatus("saving");
    try {
      const res = await fetch("/api/correct-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: row.id,
          runs: row.runs, wickets: row.wickets, catches: row.catches, runouts: row.runouts, stumpings: row.stumpings,
          fifty_bonus: row.fifty_bonus, hundred_bonus: row.hundred_bonus,
          three_w_bonus: row.three_w_bonus, five_w_bonus: row.five_w_bonus,
          mom_bonus: row.mom_bonus,
        }),
      });
      const json = await res.json();
      setStatus(json.ok ? "saved" : "error");
      if (json.ok) setTimeout(() => setStatus("idle"), 2000);
    } catch { setStatus("error"); }
  }

  const set = (field: keyof Row, val: number) => onChange({ ...row, [field]: val });

  return (
    <div style={{
      border: "1px solid #e2e8f0", borderRadius: 14, background: "white",
      padding: "12px 14px", display: "grid", gap: 10,
    }}>
      {/* Player header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 8, height: 8, borderRadius: 999, flexShrink: 0,
            background: row.side === "You" ? "#2563eb" : "#dc2626",
          }} />
          <span style={{ fontWeight: 700, fontSize: 14 }}>{row.name}</span>
          {row.captain && (
            <span style={{ fontSize: 11, fontWeight: 700, color: "#d97706", background: "#fef9c3", padding: "1px 6px", borderRadius: 5 }}>★ Cap</span>
          )}
        </div>
        <button
          onClick={save}
          disabled={status === "saving"}
          style={{
            padding: "5px 14px", borderRadius: 8, border: "none", cursor: "pointer",
            fontWeight: 700, fontSize: 12,
            background: status === "saved" ? "#dcfce7" : status === "error" ? "#fee2e2" : "#0f172a",
            color: status === "saved" ? "#15803d" : status === "error" ? "#dc2626" : "white",
          }}
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : status === "error" ? "Error" : "Save"}
        </button>
      </div>

      {/* Main stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {(["runs", "wickets"] as const).map((field) => (
          <div key={field} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
              {field === "runs" ? "Runs" : "Wickets"}
            </label>
            <Num value={row[field]} onChange={(v) => set(field, v)} />
          </div>
        ))}
        <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 10 }}>
          {([
            { k: "catches" as const, short: "CT" },
            { k: "runouts" as const, short: "RO" },
            { k: "stumpings" as const, short: "ST" },
          ]).map(({ k, short }) => (
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
                {short} <span style={{ fontWeight: 500, color: "#94a3b8" }}>({short === "CT" ? "catch" : short === "RO" ? "run-out" : "stump"})</span>
              </label>
              <Num value={row[k]} onChange={(v) => set(k, v)} />
            </div>
          ))}
        </div>
      </div>

      {/* Bonus flags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>Bonuses:</span>
        <BonusToggle label="50+" value={row.fifty_bonus} onChange={(v) => set("fifty_bonus", v)} />
        <BonusToggle label="100" value={row.hundred_bonus} onChange={(v) => set("hundred_bonus", v)} />
        <BonusToggle label="3W" value={row.three_w_bonus} onChange={(v) => set("three_w_bonus", v)} />
        <BonusToggle label="5W" value={row.five_w_bonus} onChange={(v) => set("five_w_bonus", v)} />
        <BonusToggle label="MoM" value={row.mom_bonus} onChange={(v) => set("mom_bonus", v)} />
      </div>
    </div>
  );
}

export default function ManualScorePanel({
  yourName, opponentName, players,
}: {
  yourName: string; opponentName: string; players: FantasyPlayer[];
}) {
  const [rows, setRows] = useState<Row[]>(players.map(toRow));

  const yours = rows.filter((r) => r.side === "You");
  const theirs = rows.filter((r) => r.side !== "You");

  const update = (updated: Row) =>
    setRows((prev) => prev.map((r) => r.id === updated.id ? updated : r));

  if (rows.length === 0) return null;

  return (
    <div style={{ border: "1px solid #fcd34d", borderRadius: 16, background: "#fffbeb", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 20 }}>✏️</span>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#92400e" }}>Manual score entry</div>
          <div style={{ fontSize: 13, color: "#78350f", marginTop: 2 }}>
            API is unavailable — enter stats directly. Each player has a Save button.
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gap: 20 }}>
        {yours.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#2563eb", marginBottom: 8 }}>{yourName}&apos;s team</div>
            <div style={{ display: "grid", gap: 10 }}>{yours.map((r) => <PlayerEditRow key={r.id} row={r} onChange={update} />)}</div>
          </div>
        )}
        {theirs.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#dc2626", marginBottom: 8 }}>{opponentName}&apos;s team</div>
            <div style={{ display: "grid", gap: 10 }}>{theirs.map((r) => <PlayerEditRow key={r.id} row={r} onChange={update} />)}</div>
          </div>
        )}
      </div>
      <div style={{ marginTop: 14, fontSize: 12, color: "#92400e" }}>
        Tip: after saving all players, reload the page to see updated points.
      </div>
    </div>
  );
}

const nudge: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontWeight: 700, fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 };
const numInput: React.CSSProperties = { width: 52, padding: "5px 6px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 14, textAlign: "center" as const };
