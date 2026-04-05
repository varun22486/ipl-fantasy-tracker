import { FantasyPlayer, fantasyPointsCounted, formatCtRoSt, playerPoints } from "@/lib/scoring";

type Props = {
  title: string;
  players: FantasyPlayer[];
};

const COLS = ["Player", "Cap", "R", "W", "CT/RO/ST", "50+", "100", "3W", "5W", "MoM", "Pts"] as const;

export default function PlayerTable({ title, players }: Props) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "white", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9" }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h3>
      </div>
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {COLS.map((h) => (
                <th key={h} style={{
                  textAlign: h === "Player" ? "left" : "center",
                  padding: "8px 10px", fontSize: 11, fontWeight: 700,
                  color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5,
                  borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p, idx) => {
              const pts = fantasyPointsCounted(p);
              const raw = playerPoints(p).final;
              return (
                <tr key={p.id != null ? `fp-${p.id}` : `${p.side}-${p.name}-${idx}`} style={{ borderBottom: "1px solid #f1f5f9", background: p.bench ? "#fafafa" : undefined }}>
                  <td style={{ padding: "10px 10px", fontSize: 14, fontWeight: 500 }}>
                    {p.name}
                    {p.captain && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#d97706", background: "#fef9c3", padding: "1px 5px", borderRadius: 4 }}>★ Cap</span>}
                    {p.bench && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: "#3730a3", background: "#e0e7ff", padding: "1px 5px", borderRadius: 4 }}>Sub</span>}
                  </td>
                  <td style={td}>{p.captain ? "★" : "—"}</td>
                  <td style={td}>{p.runs}</td>
                  <td style={td}>{p.wickets}</td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{formatCtRoSt(p)}</td>
                  <td style={td}>{p.fifty_bonus}</td>
                  <td style={td}>{p.hundred_bonus}</td>
                  <td style={td}>{p.three_w_bonus}</td>
                  <td style={td}>{p.five_w_bonus}</td>
                  <td style={td}>{p.mom_bonus}</td>
                  <td style={{ ...td, fontWeight: 800, fontSize: 16, color: "#0f172a" }}>
                    {pts}
                    {p.bench && raw > 0 && <div style={{ fontSize: 10, fontWeight: 500, color: "#94a3b8" }}>({raw} if in XI)</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import React from "react";
import type { CSSProperties } from "react";
const td: CSSProperties = { padding: "10px 10px", textAlign: "center", fontSize: 13, color: "#475569" };
