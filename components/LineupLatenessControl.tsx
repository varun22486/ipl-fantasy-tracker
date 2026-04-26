"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_LINEUP_LATENESS_POINTS } from "@/lib/lineup-lateness";

type Props = {
  matchId: number;
  competitionId: number | null;
  linked: boolean;
  participantOptions: string[];
  initialEnabled: boolean;
  initialLateNames: string[];
  initialPoints: number;
};

export default function LineupLatenessControl({
  matchId,
  competitionId,
  linked,
  participantOptions,
  initialEnabled,
  initialLateNames,
  initialPoints,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [lateSet, setLateSet] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const n of initialLateNames) {
      const t = n.trim();
      if (t) s.add(t);
    }
    return s;
  });
  const [points, setPoints] = useState(String(initialPoints > 0 ? initialPoints : DEFAULT_LINEUP_LATENESS_POINTS));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const initialKey = useMemo(
    () =>
      [initialEnabled, initialLateNames.join("\u0001"), initialPoints, participantOptions.join("\u0001")].join("|"),
    [initialEnabled, initialLateNames, initialPoints, participantOptions]
  );

  useEffect(() => {
    setEnabled(initialEnabled);
    const s = new Set<string>();
    for (const n of initialLateNames) {
      const t = n.trim();
      if (t) s.add(t);
    }
    setLateSet(s);
    setPoints(String(initialPoints > 0 ? initialPoints : DEFAULT_LINEUP_LATENESS_POINTS));
    // initialKey already encodes these props; avoids redundant sync when parent re-renders.
  }, [initialKey, initialEnabled, initialLateNames, initialPoints]);

  function toggleName(name: string) {
    setLateSet((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const lateList = useMemo(
    () => participantOptions.filter((n) => lateSet.has(n)),
    [lateSet, participantOptions]
  );

  async function save(nextEnabled: boolean) {
    setLoading(true);
    setMessage(null);
    const p = parseInt(points, 10);
    const pts = Number.isFinite(p) && p > 0 ? p : DEFAULT_LINEUP_LATENESS_POINTS;
    const names = nextEnabled ? lateList : [];
    try {
      const res = await fetch("/api/match-lineup-penalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId,
          enabled: nextEnabled,
          lateParticipants: nextEnabled ? names : null,
          points: nextEnabled ? pts : undefined,
          competitionId,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
      if (!json.ok) {
        setMessage(json.error ?? "Request failed");
        return;
      }
      setEnabled(nextEnabled);
      setMessage(json.message ?? (nextEnabled ? "Saved." : "Cleared."));
      router.refresh();
    } catch {
      setMessage("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!linked) {
    return (
      <div style={box}>
        <div style={title}>On-time lineup bonus</div>
        <p style={hint}>
          Link this match to a live fixture first — then you can award an on-time bonus (default +{DEFAULT_LINEUP_LATENESS_POINTS} for everyone who was not late).
        </p>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={title}>On-time lineup bonus</div>
      <p style={hint}>
        Check everyone who <strong>missed</strong> the deadline. They get <strong>no extra points</strong>; everyone else gets <strong>+</strong>
        the amount below for this match (no negative — late players just miss the bonus).
      </p>
      {enabled ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          <div style={checkCol}>
            <span style={lblInline}>Who was late?</span>
            {participantOptions.map((n) => (
              <label key={n} style={checkLbl}>
                <input type="checkbox" checked={lateSet.has(n)} onChange={() => void toggleName(n)} />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <label style={lbl}>
              Points
              <input
                type="number"
                min={1}
                max={10000}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                style={inputNum}
              />
            </label>
            <button
              type="button"
              disabled={loading || lateList.length === 0}
              onClick={() => void save(true)}
              style={btnPrimary}
            >
              {loading ? "…" : "Update rule"}
            </button>
            <button type="button" disabled={loading} onClick={() => void save(false)} style={btnGhost}>
              {loading ? "…" : "Clear rule"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
          <div style={checkCol}>
            <span style={lblInline}>Who missed the deadline?</span>
            {participantOptions.map((n) => (
              <label key={n} style={checkLbl}>
                <input type="checkbox" checked={lateSet.has(n)} onChange={() => void toggleName(n)} />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <label style={lbl}>
              Points
              <input
                type="number"
                min={1}
                max={10000}
                value={points}
                onChange={(e) => setPoints(e.target.value)}
                style={inputNum}
              />
            </label>
            <button
              type="button"
              disabled={loading || lateList.length === 0}
              onClick={() => void save(true)}
              style={btnPrimary}
            >
              {loading ? "…" : `Apply +${parseInt(points, 10) || DEFAULT_LINEUP_LATENESS_POINTS} on-time bonus`}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: /error|failed|network|Link/i.test(message) ? "#b91c1c" : "#15803d",
          }}
        >
          {message}
        </p>
      )}
    </div>
  );
}

const box: CSSProperties = {
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid #e0e7ff",
  background: "#f5f3ff",
  maxWidth: 480,
};

const title: CSSProperties = { fontSize: 13, fontWeight: 700, color: "#3730a3" };

const hint: CSSProperties = { margin: "6px 0 0", fontSize: 12, color: "#5b5d8a", lineHeight: 1.45 };

const lbl: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#475569" };

const lblInline: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 };

const checkCol: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" };

const checkLbl: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "#334155", cursor: "pointer" };

const inputNum: CSSProperties = { width: 88, padding: "6px 8px", borderRadius: 8, border: "1px solid #c7d2fe", fontSize: 13 };

const btnPrimary: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #4f46e5",
  background: "#eef2ff",
  color: "#312e81",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const btnGhost: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #94a3b8",
  background: "white",
  color: "#334155",
  fontWeight: 600,
  fontSize: 13,
  cursor: "pointer",
};
