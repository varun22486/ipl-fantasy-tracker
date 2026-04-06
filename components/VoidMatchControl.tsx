"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Props = {
  matchId: number;
  initialVoided: boolean;
};

export default function VoidMatchControl({ matchId, initialVoided }: Props) {
  const router = useRouter();
  const [voided, setVoided] = useState(initialVoided);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setVoided(initialVoided);
  }, [initialVoided]);

  async function toggle(nextVoid: boolean) {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/match-void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, void: nextVoid }),
      });
      const json = await res.json();
      if (!json.ok) {
        setMessage(json.error ?? "Request failed");
        return;
      }
      setVoided(nextVoid);
      setMessage(json.message ?? (nextVoid ? "Voided." : "Void cleared."));
      router.refresh();
    } catch {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid #e2e8f0", background: "#f8fafc", maxWidth: 420 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>Fantasy void</span>
        {voided ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void toggle(false)}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #94a3b8",
              background: "white",
              color: "#334155",
              fontWeight: 600,
              fontSize: 13,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "…" : "Remove void (match counts again)"}
          </button>
        ) : (
          <button
            type="button"
            disabled={loading}
            onClick={() => void toggle(true)}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid #b45309",
              background: "#fffbeb",
              color: "#92400e",
              fontWeight: 700,
              fontSize: 13,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "…" : "Void match — zero all scores"}
          </button>
        )}
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
        Voiding sets every player&apos;s runs, wickets, bonuses, and MoM to 0 for this match and excludes it from home / history / stats totals.
      </p>
      {message && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: /error|failed|network/i.test(message) ? "#b91c1c" : "#15803d",
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}
