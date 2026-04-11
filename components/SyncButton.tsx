"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatUiDateTime } from "@/lib/ui-time";
import { recordSyncDebugClient } from "@/lib/sync-debug-storage";
import { confirmRefreshDespiteCooldown, isWithinRefreshCooldown } from "@/lib/refresh-cooldown";

function isManualEditHint(msg: string) {
  return /✏️|manual|paid|plan|subscri|not available/i.test(msg);
}

export default function SyncButton({ matchId, lastSyncedAt }: { matchId: number; lastSyncedAt?: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "warn" | "error">("idle");
  const [message, setMessage] = useState("");

  async function sync() {
    let force = false;
    if (isWithinRefreshCooldown(lastSyncedAt)) {
      if (!confirmRefreshDespiteCooldown()) return;
      force = true;
    }
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, force }),
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

  return (
    <div className="match-sync">
      <div className="match-sync__toolbar">
        <button type="button" className="match-sync__btn" onClick={sync} disabled={status === "loading"}>
          {status === "loading" ? "Syncing…" : "⟳ Sync scores"}
        </button>
        {lastSynced ? <span className="match-sync__stamp">Last synced: {lastSynced}</span> : null}
      </div>

      {message ? (
        <div className={bannerClass}>
          <p className={msgClass}>{message}</p>
          {showEditHint ? (
            <div className="match-sync__hint">
              Use the <strong>✏️ Edit</strong> control next to each player row to enter stats manually.
              <span className="match-sync__hint-sub">
                Tip: sync while the match is <strong>live</strong> to auto-populate stats when the API allows.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
