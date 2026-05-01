"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatUiDateTime } from "@/lib/ui-time";
import { recordSyncDebugClient } from "@/lib/sync-debug-storage";
import { isWithinRefreshCooldown, minutesUntilRefreshAllowed } from "@/lib/refresh-cooldown";

function isManualEditHint(msg: string) {
  return /\u270f|manual|paid|plan|subscri|not available/i.test(msg);
}

export default function SyncButton({
  matchId,
  lastSyncedAt,
  pointsVoided = false,
  cricbuzzSyncEnabled = false,
}: {
  matchId: number;
  lastSyncedAt?: string | null;
  pointsVoided?: boolean;
  /** CricketData/CricAPI mode with a linked fixture — show optional Cricbuzz scorecard sync. */
  cricbuzzSyncEnabled?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "warn" | "error">("idle");
  const [message, setMessage] = useState("");
  const [showCooldownPrompt, setShowCooldownPrompt] = useState(false);

  async function runSync(force: boolean, cricbuzzFallback = false) {
    setShowCooldownPrompt(false);
    setStatus("loading");
    setMessage("");
    const forceBody = force || cricbuzzFallback;
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, force: forceBody, cricbuzzFallback }),
      });
      const json = await res.json();
      recordSyncDebugClient(matchId, json as Record<string, unknown>, "match-detail-sync");
      if (json.ok) {
        const msg = json.reason ?? json.message ?? "Scores updated!";
        const noStats = json.debug?.updatedRows === 0 || isManualEditHint(msg);
        setStatus(noStats ? "warn" : "ok");
        setMessage(msg);
        router.refresh();
      } else {
        setStatus("error");
        setMessage(json.error ?? "Sync failed.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error.");
    }
  }

  function onSyncClick() {
    if (isWithinRefreshCooldown(lastSyncedAt)) {
      setShowCooldownPrompt(true);
      return;
    }
    void runSync(false);
  }

  const lastSynced = lastSyncedAt ? formatUiDateTime(lastSyncedAt) : null;
  const showEditHint = (status === "warn" || status === "error") && isManualEditHint(message);

  const bannerClass =
    status === "error" ? "match-sync__banner match-sync__banner--error" :
    status === "warn" ? "match-sync__banner match-sync__banner--warn" :
    status === "ok" ? "match-sync__banner match-sync__banner--ok" :
    "match-sync__banner";

  const msgClass =
    status === "error" ? "match-sync__msg match-sync__msg--error" :
    status === "warn" ? "match-sync__msg match-sync__msg--warn" :
    status === "ok" ? "match-sync__msg match-sync__msg--ok" :
    "match-sync__msg";

  const minsLeft = minutesUntilRefreshAllowed(lastSyncedAt);

  return (
    <div className="match-sync">
      <div className="match-sync__toolbar">
        <button type="button" className="match-sync__btn" onClick={onSyncClick} disabled={status === "loading"}>
          {status === "loading" ? "Syncing…" : "\u21bb Sync scores"}
        </button>
        {cricbuzzSyncEnabled && !pointsVoided ? (
          <button
            type="button"
            className="match-sync__btn match-sync__btn--secondary"
            disabled={status === "loading"}
            onClick={() => void runSync(false, true)}
            title="Unofficial — pulls runs and wickets from the public Cricbuzz scorecard page"
          >
            {status === "loading" ? "Syncing…" : "Sync from Cricbuzz"}
          </button>
        ) : null}
        {lastSynced ? <span className="match-sync__stamp">Last synced: {lastSynced}</span> : null}
      </div>

      {showCooldownPrompt && (
        <div className="match-sync__banner match-sync__banner--warn" style={{ marginTop: 10 }}>
          <p className="match-sync__msg match-sync__msg--warn" style={{ marginBottom: 12 }}>
            Last refresh was less than 15 minutes ago. API keys are limited — sync again only if you really need the latest scores.
            {minsLeft != null ? ` You can sync without this prompt in about ${minsLeft} minute${minsLeft === 1 ? "" : "s"}.` : ""}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="match-sync__btn" onClick={() => void runSync(true)}>
              Yes, refresh anyway
            </button>
            <button
              type="button"
              className="match-sync__btn"
              style={{ opacity: 0.85 }}
              onClick={() => {
                setShowCooldownPrompt(false);
                setStatus("idle");
                setMessage("Sync skipped — last refresh was under 15 minutes ago.");
              }}
            >
              No, keep current data
            </button>
          </div>
        </div>
      )}

      {message ? (
        <div className={bannerClass}>
          <p className={msgClass}>{message}</p>
          {showEditHint ? (
            <div className="match-sync__hint">
              Use the <strong>Edit</strong> control next to each player row to enter stats manually.
              <span className="match-sync__hint-sub">
                Tip: sync while the match is <strong>live</strong> to auto-populate stats when the API allows.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {cricbuzzSyncEnabled && !pointsVoided ? (
        <p className="match-sync__hint" style={{ marginTop: 0 }}>
          <strong>Sync from Cricbuzz</strong> uses the public scorecard page (no extra API key). It can drift from CricketData — use when you want that source.
        </p>
      ) : null}
    </div>
  );
}
