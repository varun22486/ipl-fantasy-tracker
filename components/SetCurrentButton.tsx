"use client";

import { useState } from "react";

export default function SetCurrentButton({ matchId }: { matchId: number }) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    await fetch("/api/set-current", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchId }),
    });
    window.location.reload();
  }

  return (
    <button
      onClick={() => void handleClick()}
      disabled={loading}
      style={{
        fontSize: 12,
        padding: "4px 10px",
        borderRadius: 8,
        border: "1px solid #cbd5e1",
        background: "white",
        color: "#475569",
        cursor: loading ? "default" : "pointer",
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? "Setting…" : "Track for live"}
    </button>
  );
}
