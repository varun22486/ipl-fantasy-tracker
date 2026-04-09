"use client";

import { useState, useEffect } from "react";

type Settings = {
  your_name?: string;
  opponent_name?: string;
  pts_run?: number;
  pts_wicket?: number;
  pts_catch?: number;
  pts_runout?: number;
  pts_stump?: number;
  pts_fifty?: number;
  pts_hundred?: number;
  pts_three_w?: number;
  pts_five_w?: number;
  pts_mom?: number;
};

const DEFAULTS = {
  pts_run: 1,
  pts_wicket: 20,
  pts_catch: 10,
  pts_runout: 10,
  pts_stump: 10,
  pts_fifty: 10,
  pts_hundred: 20,
  pts_three_w: 10,
  pts_five_w: 20,
  pts_mom: 10,
};

const SCORING_RULES = [
  { key: "pts_run", label: "1 Run", emoji: "🏏" },
  { key: "pts_wicket", label: "1 Wicket", emoji: "🎯" },
  { key: "pts_catch", label: "1 Catch", emoji: "🙌" },
  { key: "pts_runout", label: "Run-out (fielder)", emoji: "🎯" },
  { key: "pts_stump", label: "Stumping (WK)", emoji: "🧤" },
  { key: "pts_fifty", label: "50-run bonus", emoji: "⭐" },
  { key: "pts_hundred", label: "100-run bonus", emoji: "💯" },
  { key: "pts_three_w", label: "3-wicket bonus", emoji: "🔥" },
  { key: "pts_five_w", label: "5-wicket bonus", emoji: "🔥🔥" },
  { key: "pts_mom", label: "Man of the Match", emoji: "🏆" },
] as const;

type CronLastRunSummary = {
  finishedLabel: string;
  ok: boolean;
  linkedCount: number | null;
  errorCount: number | null;
  istDate: string | null;
  errorMessage: string | null;
};

export default function SettingsClient({
  settings,
  cronLastRun,
}: {
  settings: Settings;
  cronLastRun?: CronLastRunSummary | null;
}) {
  const [yourName, setYourName] = useState(settings.your_name ?? "Varun");
  const [opponentName, setOpponentName] = useState(settings.opponent_name ?? "Rahul");
  const [pts, setPts] = useState<Record<string, number>>({
    pts_run: settings.pts_run ?? DEFAULTS.pts_run,
    pts_wicket: settings.pts_wicket ?? DEFAULTS.pts_wicket,
    pts_catch: settings.pts_catch ?? DEFAULTS.pts_catch,
    pts_runout: settings.pts_runout ?? DEFAULTS.pts_runout,
    pts_stump: settings.pts_stump ?? DEFAULTS.pts_stump,
    pts_fifty: settings.pts_fifty ?? DEFAULTS.pts_fifty,
    pts_hundred: settings.pts_hundred ?? DEFAULTS.pts_hundred,
    pts_three_w: settings.pts_three_w ?? DEFAULTS.pts_three_w,
    pts_five_w: settings.pts_five_w ?? DEFAULTS.pts_five_w,
    pts_mom: settings.pts_mom ?? DEFAULTS.pts_mom,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function save() {
    setSaving(true);
    setMessage("");
    setIsError(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ your_name: yourName.trim(), opponent_name: opponentName.trim(), ...pts }),
      });
      const json = await res.json();
      if (json.ok) {
        setMessage("Settings saved! Changes apply from next page load.");
      } else {
        setIsError(true);
        setMessage(json.error ?? "Could not save.");
      }
    } catch {
      setIsError(true);
      setMessage("Network error.");
    }
    setSaving(false);
  }

  function updatePts(key: string, val: string) {
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 0) setPts((p) => ({ ...p, [key]: n }));
  }

  return (
    <div className="settings-root">
      <section className="settings-panel" aria-labelledby="settings-names-heading">
        <h2 id="settings-names-heading" className="settings-panel__title">
          Player names
        </h2>
        <div className="settings-fields">
          <label className="settings-field">
            <span className="settings-label">Your name</span>
            <input
              className="settings-input"
              value={yourName}
              onChange={(e) => setYourName(e.target.value)}
              placeholder="e.g. Varun"
            />
          </label>
          <label className="settings-field">
            <span className="settings-label">Opponent&apos;s name</span>
            <input
              className="settings-input"
              value={opponentName}
              onChange={(e) => setOpponentName(e.target.value)}
              placeholder="e.g. Rahul"
            />
          </label>
        </div>
      </section>

      <section className="settings-panel" aria-labelledby="settings-scoring-heading">
        <div className="settings-panel__head">
          <div>
            <h2 id="settings-scoring-heading" className="settings-panel__title">
              Scoring rules
            </h2>
            <p className="settings-panel__lead">
              Points awarded per event. Captain picks up ×2 on their total.
            </p>
          </div>
          <button type="button" className="settings-btn-secondary" onClick={() => setPts({ ...DEFAULTS })}>
            Reset to defaults
          </button>
        </div>
        <div className="settings-rule-list">
          {SCORING_RULES.map(({ key, label, emoji }) => (
            <div key={key} className="settings-rule-row">
              <div className="settings-rule-row__left">
                <span className="settings-rule-row__emoji" aria-hidden>
                  {emoji}
                </span>
                <span className="settings-rule-row__label">{label}</span>
              </div>
              <div className="settings-rule-row__controls">
                <button
                  type="button"
                  className="settings-btn-nudge"
                  onClick={() => updatePts(key, String((pts[key] ?? 0) - 1))}
                  disabled={(pts[key] ?? 0) <= 0}
                  aria-label={`Decrease points for ${label}`}
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  className="settings-input settings-input--num"
                  value={pts[key] ?? 0}
                  onChange={(e) => updatePts(key, e.target.value)}
                  aria-label={`Points for ${label}`}
                />
                <button
                  type="button"
                  className="settings-btn-nudge"
                  onClick={() => updatePts(key, String((pts[key] ?? 0) + 1))}
                  aria-label={`Increase points for ${label}`}
                >
                  +
                </button>
                <span className="settings-rule-row__suffix">pts</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="settings-actions">
        <button type="button" className="settings-btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
        {message ? (
          <span className={`settings-inline-status${isError ? " settings-inline-status--err" : " settings-inline-status--ok"}`}>
            {isError ? "✗ " : "✓ "}
            {message}
          </span>
        ) : null}
      </div>

      <div className="settings-callout" role="note">
        <strong>Note:</strong> Changing scoring rules updates future calculations but does <em>not</em> retroactively re-sync
        past match stats from the API — existing raw stats (runs, wickets, catches) will be re-scored automatically with the
        new values.
      </div>

      <SyncAndDataPanel cronLastRun={cronLastRun ?? null} />

      <CompetitionsPanel />
    </div>
  );
}

type Competition = { id: number; name: string; player1_name: string; player2_name: string; players?: unknown };

function SyncAndDataPanel({ cronLastRun }: { cronLastRun: CronLastRunSummary | null }) {
  return (
    <div className="settings-sync-panel">
      <h2 className="settings-sync-panel__title">Sync &amp; data</h2>
      <ul className="settings-sync-panel__list">
        <li>
          <strong>Live scores</strong> come from your configured cricket API. Each <strong>Sync scores</strong> action uses API
          credits (see the quota bar on the home / match screens). If keys are rate-limited or the daily quota is used, wait
          for the time shown in the error message (often ~15 minutes or until the next UTC day).
        </li>
        <li>
          <strong>Link match</strong> loads today&apos;s IPL fixtures from the feed, then saves the fixture you pick. A scheduled
          job can auto-link today&apos;s IPL rows if you deploy with <code className="settings-sync-panel__code">vercel.json</code>{" "}
          cron and set <code className="settings-sync-panel__code">CRON_SECRET</code> (see Debug → API diagnostics).
        </li>
        <li>
          Optional env <code className="settings-sync-panel__code">CRICKET_HTTP_TIMEOUT_MS</code> (8000–120000, default 28000)
          caps how long each provider HTTP call may run before timing out.
        </li>
      </ul>
      <div className="settings-sync-panel__cron" role="status">
        <span className="settings-sync-panel__cron-label">Last IPL auto-link (cron)</span>
        {cronLastRun == null ? (
          <span className="settings-sync-panel__cron-value settings-sync-panel__cron-value--muted">
            No run recorded yet — run the migration for <code>cron_job_runs</code> if you use scheduled auto-link.
          </span>
        ) : (
          <span className="settings-sync-panel__cron-value">
            {cronLastRun.finishedLabel}
            {cronLastRun.ok ? (
              <>
                {" "}
                · linked {cronLastRun.linkedCount ?? "—"}
                {cronLastRun.errorCount != null && cronLastRun.errorCount > 0
                  ? ` · ${cronLastRun.errorCount} error(s)`
                  : ""}
                {cronLastRun.istDate ? ` · IST ${cronLastRun.istDate}` : ""}
              </>
            ) : (
              <> · failed{cronLastRun.errorMessage ? `: ${cronLastRun.errorMessage}` : ""}</>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function CompetitionsPanel() {
  const [competitions, setCompetitions] = useState<Competition[]>([]);
  const [newPlayers, setNewPlayers] = useState<string[]>(["", ""]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/competitions")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setCompetitions(j.competitions);
      });
  }, []);

  function updatePlayer(idx: number, val: string) {
    setNewPlayers((prev) => prev.map((p, i) => (i === idx ? val : p)));
  }

  async function add() {
    const players = newPlayers.map((p) => p.trim()).filter(Boolean);
    if (players.length < 2) return;
    setSaving(true);
    setMsg("");
    try {
      const r = await fetch("/api/competitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players }),
      });
      const j = await r.json();
      if (j.ok) {
        setCompetitions((prev) => [...prev, j.competition]);
        setNewPlayers(["", ""]);
        setMsg("Created!");
      } else setMsg(j.error || "Failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("Delete this competition and all its player picks?")) return;
    await fetch("/api/competitions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setCompetitions((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <section className="settings-panel" aria-labelledby="settings-comp-heading">
      <h2 id="settings-comp-heading" className="settings-panel__title settings-panel__title--with-lead">
        Competitions
      </h2>
      <p className="settings-panel__lead" style={{ marginBottom: 16 }}>
        Each competition is a group of 2 or more players tracking their fantasy picks together. Switch between them using the
        selector at the top of the sidebar. Your original &quot;Default&quot; competition is always available.
      </p>

      {competitions.length === 0 ? (
        <p className="settings-comp-empty">No extra competitions yet.</p>
      ) : (
        <div className="settings-comp-list">
          {competitions.map((c) => {
            const players: string[] = Array.isArray(c.players)
              ? (c.players as string[])
              : [c.player1_name, c.player2_name];
            return (
              <div key={c.id} className="settings-comp-row">
                <div className="settings-comp-row__body">
                  {players.map((p, i) => (
                    <span key={`${c.id}-${i}`}>
                      <span className="settings-comp-row__name">{p}</span>
                      {i < players.length - 1 && <span className="settings-comp-row__sep">·</span>}
                    </span>
                  ))}
                  <span className="settings-comp-row__meta">{players.length} players</span>
                </div>
                <button type="button" className="settings-btn-danger" onClick={() => void remove(c.id)}>
                  Delete
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="settings-fields" style={{ gap: 10 }}>
        <div className="settings-comp-label">Create new competition</div>
        <div className="settings-comp-add-grid">
          {newPlayers.map((p, i) => (
            <div key={i} className="settings-comp-line">
              <input
                className="settings-input"
                style={{ flex: 1 }}
                value={p}
                onChange={(e) => updatePlayer(i, e.target.value)}
                placeholder={`Player ${i + 1} name`}
              />
              {newPlayers.length > 2 && (
                <button
                  type="button"
                  className="settings-btn-danger settings-btn-danger--icon"
                  onClick={() => setNewPlayers((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove player ${i + 1} row`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="settings-btn-secondary settings-btn-add-player" onClick={() => setNewPlayers((prev) => [...prev, ""])}>
            + Add another player
          </button>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="settings-btn-primary"
            onClick={() => void add()}
            disabled={saving || newPlayers.filter((p) => p.trim()).length < 2}
          >
            {saving ? "Creating…" : `Create competition (${newPlayers.filter((p) => p.trim()).length} players)`}
          </button>
          {msg ? (
            <span className={msg === "Created!" ? "settings-inline-status settings-inline-status--ok" : "settings-inline-status settings-inline-status--err"}>
              {msg}
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
