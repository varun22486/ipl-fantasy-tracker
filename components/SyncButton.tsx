"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatUiDateTime } from "@/lib/ui-time";
import { recordSyncDebugClient } from "@/lib/sync-debug-storage";

function isManualEditHint(msg: string) {
  return /✏️|manual|paid|plan|subscri|not available/i.test(msg);
}

export default function SyncButton({ matchId, lastSyncedAt }: { matchId: number; lastSyncedAt?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "warn" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sync() {
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId }),
      });
      const json = await res.json();
      recordSyncDebugClient(matchId, json as Record<string, unknown>, "match-detail-sync");
      if (json.ok) {
        const msg = json.reason ?? json.message ?? "Scores updated!";
        const noStats = json.debug?.updatedRows === 0 || isManualEditHint(msg);
        setStatus(noStats ? "warn" : "ok");
        setMessage(msg);
        if (!json.skipped) router.refresh();
      } else {
        setStatus("error");
        setMessage(json.error ?? "Sync failed.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error.");
    }
  }

  const lastSynced = lastSyncedAt ? formatUiDateTime(lastSyncedAt) : null;

  const msgColor =
    status === "error" ? "#dc2626" :
    status === "warn"  ? "#92400e" :
    status === "ok"    ? "#16a34a" : "#475569";

  const showEditHint = (status === "warn" || status === "error") && isManualEditHint(message);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={sync}
          disabled={status === "loading"}
          style={{
            padding: "10px 18px",
            borderRadius: 14,
            border: "none",
            background:
              status === "loading"
                ? "var(--surface-muted)"
                : "linear-gradient(180deg, #2563eb 0%, #1d4ed8 100%)",
            color: status === "loading" ? "var(--text-muted)" : "white",
            cursor: status === "loading" ? "not-allowed" : "pointer",
            fontWeight: 600,
            fontSize: 14,
            boxShadow: status === "loading" ? "none" : "0 2px 14px rgba(37,99,235,0.3)",
          }}
        >
          {status === "loading" ? "Syncing…" : "⟳ Sync Scores"}
        </button>
        {lastSynced && (
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Last synced: {lastSynced}</span>
        )}
      </div>

      {message && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: status === "warn" ? "#fffbeb" : status === "error" ? "#fef2f2" : "#f0fdf4", border: `1px solid ${status === "warn" ? "#fde68a" : status === "error" ? "#fecaca" : "#bbf7d0"}` }}>
          <div style={{ fontSize: 13, color: msgColor, fontWeight: 500 }}>{message}</div>
          {showEditHint && (
            <div style={{ marginTop: 8, fontSize: 13, color: "#64748b" }}>
              👉 Use the <strong>✏️ Edit button</strong> next to each player row below to enter their stats manually.
              <br />
              <span style={{ fontSize: 12, color: "#94a3b8", marginTop: 4, display: "block" }}>
                Tip: next time sync while the match is <strong>live</strong> to auto-populate stats for free.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
