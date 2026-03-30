"use client";

import { useState } from "react";

export default function SyncButton({ matchId, lastSyncedAt }: { matchId: number; lastSyncedAt?: string | null }) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
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
      if (json.ok) {
        setStatus("ok");
        setMessage(json.reason ?? json.message ?? "Scores updated!");
        if (!json.skipped) window.setTimeout(() => window.location.reload(), 1000);
      } else {
        setStatus("error");
        setMessage(json.error ?? "Sync failed.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error.");
    }
  }

  const lastSynced = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
    : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button
        onClick={sync}
        disabled={status === "loading"}
        style={{
          padding: "8px 16px",
          borderRadius: 10,
          border: "1px solid #0f172a",
          background: status === "loading" ? "#f1f5f9" : "#0f172a",
          color: status === "loading" ? "#64748b" : "white",
          cursor: status === "loading" ? "not-allowed" : "pointer",
          fontWeight: 600,
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {status === "loading" ? "Syncing…" : "⟳ Sync Scores"}
      </button>
      {lastSynced && (
        <span style={{ fontSize: 12, color: "#94a3b8" }}>Last synced: {lastSynced}</span>
      )}
      {message && (
        <span style={{
          fontSize: 13,
          color: status === "error" ? "#dc2626" : status === "ok" ? "#16a34a" : "#475569",
          fontWeight: status === "ok" ? 600 : 400,
        }}>
          {status === "ok" ? "✓ " : status === "error" ? "✗ " : ""}{message}
        </span>
      )}
    </div>
  );
}
