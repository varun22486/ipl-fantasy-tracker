"use client";

/** One column in the MoM totals plot: total awards vs matches entered for that participant. */
export type MomPlotRow = { participant: string; mom: number; matches: number; fill: string };

/**
 * Vertical bar chart — total MoM per participant, with match count under each name.
 * Pure CSS so it always renders in flex/grid layouts.
 */
export function MomAwardBars({ rows }: { rows: MomPlotRow[] }) {
  const maxMom = Math.max(...rows.map((r) => r.mom), 1);
  const chartH = 168;

  return (
    <div style={{ paddingTop: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 12,
          height: chartH,
          borderBottom: "2px solid var(--border, #e2e8f0)",
          paddingLeft: 4,
          paddingRight: 4,
        }}
      >
        {rows.map((row) => {
          const hPct = maxMom > 0 ? (row.mom / maxMom) * 100 : 0;
          const barPx = Math.max(row.mom > 0 ? 6 : 0, (hPct / 100) * chartH);
          return (
            <div
              key={row.participant}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                minWidth: 0,
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 800, color: row.fill, lineHeight: 1, marginBottom: 6 }}>{row.mom}</div>
              <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                <div
                  title={`${row.mom} MoM in ${row.matches} matches`}
                  style={{
                    width: "min(72px, 100%)",
                    height: barPx,
                    borderRadius: "10px 10px 0 0",
                    background: row.fill,
                    opacity: row.mom > 0 ? 1 : 0.35,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 12, paddingLeft: 4, paddingRight: 4 }}>
        {rows.map((row) => (
          <div key={row.participant} style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text, #0f172a)", wordBreak: "break-word" }}>{row.participant}</div>
            <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)", marginTop: 4 }}>{row.matches} matches</div>
          </div>
        ))}
      </div>
    </div>
  );
}
