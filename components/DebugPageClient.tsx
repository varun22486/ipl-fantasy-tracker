"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { formatFixture } from "@/lib/format";
import { formatUiDateTime } from "@/lib/ui-time";
import {
  readSyncDebugClient,
  clearSyncDebugClient,
  type SyncDebugRecord,
} from "@/lib/sync-debug-storage";

const AuditTrailPanel = dynamic(() => import("@/components/AuditTrailPanel"), {
  loading: () => <p className="debug-page__muted">Loading audit trail…</p>,
});
const MatchSnapshotsPanel = dynamic(() => import("@/components/MatchSnapshotsPanel"), {
  loading: () => <p className="debug-page__muted">Loading snapshots…</p>,
});

type MatchOpt = { id: number; fixture: string | null };

export default function DebugPageClient({
  matches,
  competitionId,
  initialMatchId,
  competitionQuery,
}: {
  matches: MatchOpt[];
  competitionId: number | null;
  initialMatchId: number | null;
  /** `?c=1` or "" */
  competitionQuery: string;
}) {
  const [matchId, setMatchId] = useState<number>(() => initialMatchId ?? matches[0]?.id ?? 0);
  const [snapshot, setSnapshot] = useState<SyncDebugRecord | null>(null);

  const refreshSnapshot = useCallback(() => {
    setSnapshot(readSyncDebugClient());
  }, []);

  useEffect(() => {
    refreshSnapshot();
  }, [refreshSnapshot]);

  useEffect(() => {
    if (initialMatchId && matches.some((m) => m.id === initialMatchId)) {
      setMatchId(initialMatchId);
    }
  }, [initialMatchId, matches]);

  const validMatch = matchId > 0 && matches.some((m) => m.id === matchId);
  const payload = snapshot?.payload;
  const dbg = payload?.debug as Record<string, unknown> | undefined;

  return (
    <div className="debug-page">
      <section className="debug-page__section" aria-labelledby="debug-sync-h">
        <h2 id="debug-sync-h" className="debug-page__h2">
          Last API response (this tab)
        </h2>
        <p className="debug-page__lead">
          After you <strong>Sync</strong> from Match or Match detail, the JSON response is stored here for this browser
          session. Use it to see <code>matched</code>, <code>unmatched</code>, and provider samples.
        </p>
        <div className="debug-page__row">
          <button type="button" className="debug-page__btn" onClick={refreshSnapshot}>
            Refresh
          </button>
          <button type="button" className="debug-page__btn debug-page__btn--ghost" onClick={() => { clearSyncDebugClient(); refreshSnapshot(); }}>
            Clear
          </button>
        </div>
        {!snapshot ? (
          <p className="debug-page__muted">Nothing captured yet — run a sync from the Match page.</p>
        ) : (
          <div className="debug-page__card">
            <div className="debug-page__meta">
              <span>
                <strong>Recorded:</strong> {formatUiDateTime(snapshot.recordedAt)}
              </span>
              {snapshot.source ? (
                <span>
                  <strong>Source:</strong> {snapshot.source}
                </span>
              ) : null}
              {snapshot.matchId != null ? (
                <span>
                  <strong>Match id:</strong> {snapshot.matchId}
                </span>
              ) : null}
            </div>
            <div className="debug-page__body">
              <p style={{ margin: "0 0 8px", color: "var(--text)" }}>
                {(payload?.error as string) || (payload?.reason as string) || (payload?.message as string) || "—"}
              </p>
              {typeof payload?.live_summary === "string" && (
                <p className="debug-page__line">
                  <strong>Live summary:</strong> {payload.live_summary}
                </p>
              )}
              {dbg && typeof dbg.updatedRows === "number" && (
                <p className="debug-page__line">
                  <strong>Updated rows:</strong> {String(dbg.updatedRows)} / {String(dbg.selectedCount ?? "—")}
                </p>
              )}
              {dbg && typeof dbg.providerRowCount === "number" && (
                <p className="debug-page__line">
                  <strong>Provider rows:</strong> {String(dbg.providerRowCount)}
                </p>
              )}
              {dbg && dbg.status != null && (
                <p className="debug-page__line">
                  <strong>Provider status:</strong> {String(dbg.status)}
                </p>
              )}
              {Array.isArray(dbg?.unmatched) && (dbg.unmatched as unknown[]).length > 0 && (
                <p className="debug-page__line">
                  <strong>Unmatched:</strong> {(dbg.unmatched as string[]).join(", ")}
                </p>
              )}
              {Array.isArray(dbg?.matched) && (dbg.matched as unknown[]).length > 0 && (
                <details className="debug-page__details">
                  <summary>Matched name pairs ({(dbg.matched as unknown[]).length})</summary>
                  <pre className="debug-page__pre">
                    {(dbg.matched as { selected: string; provider: string; matchedById?: boolean }[])
                      .slice(0, 80)
                      .map((m) => `${m.selected} → ${m.provider}${m.matchedById ? " (id)" : ""}`)
                      .join("\n")}
                  </pre>
                </details>
              )}
              {Array.isArray(dbg?.providerPlayersSample) && (
                <p className="debug-page__line">
                  <strong>Provider sample:</strong> {(dbg.providerPlayersSample as string[]).join(", ")}
                </p>
              )}
              {dbg?.sourceUrl != null && (
                <p className="debug-page__line">
                  <strong>Source URL:</strong>{" "}
                  <a href={String(dbg.sourceUrl)} target="_blank" rel="noreferrer">
                    {String(dbg.sourceUrl)}
                  </a>
                </p>
              )}
              <details className="debug-page__details">
                <summary>Raw JSON</summary>
                <pre className="debug-page__pre">{JSON.stringify(payload, null, 2)}</pre>
              </details>
            </div>
          </div>
        )}
      </section>

      <section className="debug-page__section" aria-labelledby="debug-audit-h">
        <h2 id="debug-audit-h" className="debug-page__h2">
          Audit trail &amp; snapshots
        </h2>
        <p className="debug-page__lead">Choose a match from your database. Lineup and score snapshots are per <code>match_id</code>.</p>
        <label className="debug-page__label">
          Match
          <select
            className="debug-page__select"
            value={validMatch ? matchId : ""}
            onChange={(e) => setMatchId(parseInt(e.target.value, 10) || 0)}
          >
            {matches.length === 0 ? (
              <option value="">No matches</option>
            ) : (
              matches.map((m) => (
                <option key={m.id} value={m.id}>
                  {formatFixture(m.fixture ?? "") || m.fixture || `Match ${m.id}`}
                </option>
              ))
            )}
          </select>
        </label>
        {validMatch ? (
          <>
            <p className="debug-page__muted" style={{ marginTop: 12 }}>
              <Link
                href={`/match/${matchId}${competitionQuery ? `?${competitionQuery}` : ""}`}
                className="match-detail-link-back"
              >
                Open match detail →
              </Link>
            </p>
            <div className="debug-page__panels">
              <MatchSnapshotsPanel matchId={matchId} />
              <AuditTrailPanel matchId={matchId} competitionId={competitionId} />
            </div>
          </>
        ) : (
          <p className="debug-page__muted">Link a match first.</p>
        )}
      </section>

      <section className="debug-page__section" aria-labelledby="debug-api-h">
        <h2 id="debug-api-h" className="debug-page__h2">
          API diagnostics
        </h2>
        <ul className="debug-page__list">
          <li>
            <a href="/api/debug-matches" target="_blank" rel="noreferrer">
              /api/debug-matches
            </a>{" "}
            — raw CricAPI samples (keys redacted in response handling; uses server env keys).
          </li>
          <li>
            <a href="/api/key-stats" target="_blank" rel="noreferrer">
              /api/key-stats
            </a>{" "}
            — per-key usage today.
          </li>
          <li>
            <code>/api/debug-roster?id=EXTERNAL_MATCH_UUID</code> — roster field scan (open in browser with a real id from
            your linked fixture).
          </li>
          <li>
            <code>GET /api/cron/auto-link-ipl</code> with header <code>Authorization: Bearer $CRON_SECRET</code> — daily
            auto-link of IPL rows for the current IST calendar day (Vercel: <code>vercel.json</code> at 02:30 UTC ≈ 8:00
            AM IST). Last run is stored in <code>cron_job_runs</code> and shown on Settings.
          </li>
          <li>
            <code>CRICKET_HTTP_TIMEOUT_MS</code> — optional per-request timeout for provider HTTP calls (8000–120000 ms,
            default 28000).
          </li>
        </ul>
      </section>
    </div>
  );
}
