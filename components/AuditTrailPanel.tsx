"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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

function manualScoreRestoreTarget(ev: AuditEvent): { auditEventId: number; playerId: number } | null {
  if (ev.action !== "manual_score") return null;
  const d = ev.detail as Record<string, unknown> | null;
  if (!d || typeof d !== "object") return null;
  const before = d.before;
  if (before == null || typeof before !== "object") return null;
  const playerId = Number(d.playerId);
  if (!Number.isFinite(playerId) || playerId < 1) return null;
  return { auditEventId: ev.id, playerId };
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
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

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
          ? "Logged when a lineup is saved or scores are edited manually after the match has started (or 5+ min past the scheduled start), and when a Cricbuzz fallback scorecard fetch runs (for debugging). You can restore a player’s stats from any “before” snapshot on manual score entries. Void-only actions are not logged — use ✏️ Edit if there is no audit row."
          : "Hidden until expanded."}
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {loadError && (
            <div style={{ fontSize: 13, color: "#b45309", marginBottom: 8 }}>{loadError}</div>
          )}
          {restoreMsg && (
            <div
              style={{
                fontSize: 13,
                marginBottom: 8,
                color: /error|fail/i.test(restoreMsg) ? "#b45309" : "#15803d",
              }}
            >
              {restoreMsg}
            </div>
          )}
          {!loadError && events.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: "#92400e" }}>No late edits recorded for this match yet.</div>
          )}
          {events.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
              {events.map((ev) => {
                const restoreTarget = manualScoreRestoreTarget(ev);
                return (
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
                    {ev.action === "lineup_change"
                      ? "Lineup"
                      : ev.action === "cricbuzz_scorecard"
                        ? "Cricbuzz fallback"
                        : "Manual scores"}
                    {ev.side ? ` · ${ev.side}` : ""}
                  </div>
                  {restoreTarget && (
                    <div style={{ marginBottom: 8 }}>
                      <button
                        type="button"
                        disabled={restoringId != null}
                        onClick={async () => {
                          setRestoreMsg(null);
                          setRestoringId(ev.id);
                          try {
                            const res = await fetch("/api/restore-audit-scores", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ auditEventId: restoreTarget.auditEventId }),
                            });
                            const json = await res.json();
                            if (json.ok) {
                              setRestoreMsg(json.message ?? "Restored.");
                              router.refresh();
                              await load();
                            } else {
                              setRestoreMsg(json.error ?? "Restore failed.");
                            }
                          } catch {
                            setRestoreMsg("Network error.");
                          }
                          setRestoringId(null);
                        }}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 8,
                          border: "1px solid #ca8a04",
                          background: "#fff",
                          color: "#713f12",
                          fontWeight: 600,
                          fontSize: 12,
                          cursor: restoringId != null ? "wait" : "pointer",
                        }}
                      >
                        {restoringId === ev.id ? "Restoring…" : "Restore player stats to “before”"}
                      </button>
                    </div>
                  )}
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
              );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
