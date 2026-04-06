"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { formatUiDateTime } from "@/lib/ui-time";
import {
  MATCH_SNAPSHOT_MAX_PER_MATCH,
  MANUAL_SCORE_SNAPSHOT_COOLDOWN_MS,
} from "@/lib/match-snapshot-constants";

type SnapshotRow = {
  id: number;
  source: string;
  sourceLabel: string;
  summary: string | null;
  created_at: string;
  playerCount: number;
};

export default function MatchSnapshotsPanel({ matchId }: { matchId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkpointNote, setCheckpointNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/match-snapshots?matchId=${matchId}`);
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "Could not load snapshots.");
        setSnapshots([]);
      } else {
        setSnapshots(Array.isArray(json.snapshots) ? json.snapshots : []);
      }
    } catch {
      setError("Network error.");
      setSnapshots([]);
    }
    setLoading(false);
  }, [matchId]);

  async function saveCheckpoint() {
    setSaving(true);
    setBanner(null);
    try {
      const res = await fetch("/api/match-snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId,
          source: "user_checkpoint",
          summary: checkpointNote.trim() || "Manual checkpoint",
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setBanner("Checkpoint saved.");
        setCheckpointNote("");
        await load();
        router.refresh();
      } else {
        setBanner(json.error ?? "Save failed.");
      }
    } catch {
      setBanner("Network error.");
    }
    setSaving(false);
  }

  async function restore(id: number) {
    if (
      !window.confirm(
        "Restore this snapshot? Current lineups, scores, void flag, and live summary for this match will be replaced. A safety snapshot of the current state is saved first."
      )
    ) {
      return;
    }
    setRestoringId(id);
    setBanner(null);
    try {
      const res = await fetch("/api/match-snapshots/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId: id }),
      });
      const json = await res.json();
      if (json.ok) {
        setBanner(json.message ?? "Restored.");
        await load();
        router.refresh();
      } else {
        setBanner(json.error ?? "Restore failed.");
      }
    } catch {
      setBanner("Network error.");
    }
    setRestoringId(null);
  }

  const cooldownSec = Math.round(MANUAL_SCORE_SNAPSHOT_COOLDOWN_MS / 1000);

  return (
    <div
      style={{
        marginTop: 20,
        border: "1px solid #c7d2fe",
        borderRadius: 14,
        background: "#eef2ff",
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
          color: "#3730a3",
          padding: 0,
          fontSize: 13,
        }}
      >
        {open ? "▾" : "▸"} Saved states & recovery
        {loading ? " …" : ""}
        {!loading && snapshots.length > 0 ? ` (${snapshots.length})` : ""}
      </button>
      <div style={{ fontSize: 11, color: "#4338ca", marginTop: open ? 6 : 0, lineHeight: 1.45 }}>
        {open
          ? `Automatic snapshots before sync, void, lineup save, and manual score edits (at most once every ${cooldownSec}s while editing). Keeps the last ${MATCH_SNAPSHOT_MAX_PER_MATCH} per match. Restoring replaces all player rows for this match (every competition) and match summary fields.`
          : "Hidden until expanded."}
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {error && (
            <div style={{ fontSize: 13, color: "#7f1d1d", marginBottom: 10, padding: 10, background: "#fef2f2", borderRadius: 10 }}>
              {error}
              {/relation|does not exist/i.test(error) ? (
                <div style={{ marginTop: 8 }}>
                  Run the new SQL in <code style={{ fontSize: 11 }}>supabase/schema.sql</code> (table{" "}
                  <code style={{ fontSize: 11 }}>match_state_snapshots</code>) on your project.
                </div>
              ) : null}
            </div>
          )}
          {banner && (
            <div
              style={{
                fontSize: 13,
                marginBottom: 10,
                padding: 10,
                borderRadius: 10,
                background: /fail|error/i.test(banner) ? "#fef2f2" : "#ecfdf5",
                color: /fail|error/i.test(banner) ? "#7f1d1d" : "#065f46",
              }}
            >
              {banner}
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <input
              type="text"
              value={checkpointNote}
              onChange={(e) => setCheckpointNote(e.target.value)}
              placeholder="Optional label (e.g. before risky edit)"
              style={{
                flex: "1 1 200px",
                minWidth: 160,
                padding: "8px 12px",
                borderRadius: 10,
                border: "1px solid #a5b4fc",
                fontSize: 13,
              }}
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveCheckpoint()}
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                border: "none",
                background: saving ? "#c7d2fe" : "#4f46e5",
                color: "white",
                fontWeight: 600,
                fontSize: 13,
                cursor: saving ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "Saving…" : "Save checkpoint now"}
            </button>
          </div>

          {!error && snapshots.length === 0 && !loading && (
            <div style={{ fontSize: 13, color: "#4338ca" }}>No snapshots yet — they appear after the next sync, lineup save, or score edit.</div>
          )}

          {snapshots.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
              {snapshots.map((s) => (
                <li
                  key={s.id}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.85)",
                    border: "1px solid #c7d2fe",
                    fontSize: 12,
                    color: "#1e1b4b",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{formatUiDateTime(s.created_at)}</div>
                  <div style={{ color: "#4338ca", marginTop: 4 }}>
                    {s.sourceLabel}
                    {s.summary ? ` — ${s.summary}` : ""}
                  </div>
                  <div style={{ color: "#64748b", marginTop: 4 }}>{s.playerCount} player row{s.playerCount === 1 ? "" : "s"}</div>
                  <button
                    type="button"
                    disabled={restoringId != null}
                    onClick={() => void restore(s.id)}
                    style={{
                      marginTop: 8,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid #6366f1",
                      background: "#fff",
                      color: "#312e81",
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: restoringId != null ? "wait" : "pointer",
                    }}
                  >
                    {restoringId === s.id ? "Restoring…" : "Restore this state"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
