"use client";

import { useState, useEffect, useCallback } from "react";
import { formatUiDateTime } from "@/lib/ui-time";

type AuditEvent = {
  id: number;
  action: string;
  side: string | null;
  summary: string;
  detail: unknown;
  created_at: string;
};

function formatDetail(detail: unknown): string {
  if (detail == null) return "—";
  try {
    return JSON.stringify(detail, null, 2);
  } catch {
    return String(detail);
  }
}

/**
 * Collapsible log of late lineup changes and manual score edits (see /api/lineup, /api/correct-score).
 */
export default function AuditTrailPanel({
  matchId,
  competitionId,
}: {
  matchId: number | null | undefined;
  competitionId?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setEvents([]);
    setLoadError(null);
  }, [matchId, competitionId]);

  const load = useCallback(async () => {
    if (matchId == null || matchId <= 0) return;
    setLoading(true);
    setLoadError(null);
    try {
      const q = new URLSearchParams({ matchId: String(matchId) });
      if (competitionId != null) q.set("c", String(competitionId));
      const res = await fetch(`/api/match-audit?${q}`);
      const json = await res.json();
      if (!json.ok) {
        setLoadError(json.error ?? "Could not load audit trail.");
        setEvents([]);
      } else {
        setEvents(Array.isArray(json.events) ? json.events : []);
      }
    } catch {
      setLoadError("Network error.");
      setEvents([]);
    }
    setLoading(false);
  }, [matchId, competitionId]);

  if (matchId == null || matchId <= 0) return null;

  return (
    <div
      style={{
        marginTop: 20,
        border: "1px solid #fde68a",
        borderRadius: 14,
        background: "#fffbeb",
        padding: "10px 14px",
      }}
    >
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontWeight: 700,
          color: "#92400e",
          padding: 0,
          fontSize: 13,
        }}
      >
        {open ? "▾" : "▸"} Audit trail
        {loading ? " …" : ""}
        {!loading && events.length > 0 ? ` (${events.length})` : ""}
      </button>
      <div style={{ fontSize: 11, color: "#a16207", marginTop: open ? 6 : 0, lineHeight: 1.4 }}>
        {open
          ? "Logged when a lineup is saved or scores are edited manually after the match has started (or 5+ min past the scheduled start)."
          : "Hidden until expanded."}
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {loadError && (
            <div style={{ fontSize: 13, color: "#b45309", marginBottom: 8 }}>{loadError}</div>
          )}
          {!loadError && events.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: "#92400e" }}>No late edits recorded for this match yet.</div>
          )}
          {events.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {events.map((ev) => (
                <li
                  key={ev.id}
                  style={{
                    borderTop: "1px solid #fcd34d",
                    paddingTop: 10,
                    fontSize: 12,
                    color: "#422006",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 4 }}>
                    {formatUiDateTime(ev.created_at)} — {ev.summary}
                  </div>
                  <div style={{ fontSize: 11, color: "#78350f", marginBottom: 6 }}>
                    {ev.action === "lineup_change" ? "Lineup" : "Manual scores"}
                    {ev.side ? ` · ${ev.side}` : ""}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 10,
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.75)",
                      border: "1px solid #fde68a",
                      fontSize: 11,
                      overflow: "auto",
                      maxHeight: 220,
                      color: "#1c1917",
                    }}
                  >
                    {formatDetail(ev.detail)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
