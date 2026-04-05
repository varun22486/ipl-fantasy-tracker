import Link from "next/link";

const ROW_COLORS = [
  "linear-gradient(90deg, rgba(250, 204, 21, 0.22) 0%, rgba(251, 191, 36, 0.06) 100%)",
  "linear-gradient(90deg, rgba(203, 213, 225, 0.35) 0%, rgba(226, 232, 240, 0.08) 100%)",
  "linear-gradient(90deg, rgba(180, 83, 9, 0.18) 0%, rgba(217, 119, 6, 0.06) 100%)",
];

const BAR_COLORS = ["#eab308", "#94a3b8", "#d97706", "#2563eb", "#dc2626", "#16a34a", "#7c3aed", "#0891b2"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Participant = { name: string; totalPoints: number; wins: number; matches: number };

export default function SeriesStandingsHero({
  participants,
  nextMatch,
}: {
  participants: Participant[];
  nextMatch: { fixture: string; date: string; venue: string | null } | null;
}) {
  const lead = participants[0]?.totalPoints ?? 0;
  const maxPts = Math.max(lead, 1);

  return (
    <section className="home-hero home-hero--standings" aria-labelledby="series-standings-heading">
      <div className="home-hero__inner">
        <p className="home-hero__eyebrow">Multi-player competition</p>
        <div className="standings-hero__title-row">
          <h2 id="series-standings-heading" className="home-hero__title">
            Series Standings
          </h2>
          <span className="standings-hero__badge">{participants.length} players</span>
        </div>
        <p className="standings-hero__subtitle">
          Cumulative fantasy points across the season — chase the top spot each match day.
        </p>

        <div className="standings-hero__list">
          {participants.map((p, i) => {
            const pct = (p.totalPoints / maxPts) * 100;
            const barColor = BAR_COLORS[i % BAR_COLORS.length];
            const winPct = p.matches > 0 ? Math.round((p.wins / p.matches) * 100) : null;
            const rankClass =
              i === 0
                ? "standings-hero__row--gold"
                : i === 1
                  ? "standings-hero__row--silver"
                  : i === 2
                    ? "standings-hero__row--bronze"
                    : "standings-hero__row--rest";

            return (
              <div
                key={p.name}
                className={`standings-hero__row ${rankClass}`}
                style={{ background: i < 3 ? ROW_COLORS[i] : undefined }}
              >
                <div className="standings-hero__rank" aria-label={`Rank ${i + 1}`}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="standings-hero__rank-num">#{i + 1}</span>}
                </div>
                <div className="standings-hero__avatar" style={{ borderColor: barColor, color: barColor }}>
                  {initials(p.name)}
                </div>
                <div className="standings-hero__body">
                  <div className="standings-hero__name">{p.name}</div>
                  <div className="standings-hero__track">
                    <div
                      className="standings-hero__track-fill"
                      style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)` }}
                    />
                  </div>
                </div>
                <div className="standings-hero__stats">
                  <div className="standings-hero__pts">{p.totalPoints}</div>
                  <div className="standings-hero__meta">
                    <span className="standings-hero__pill">{p.wins}W</span>
                    <span className="standings-hero__muted">{p.matches} played</span>
                    {winPct != null && p.matches > 0 && (
                      <span className="standings-hero__muted">{winPct}% win rate</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {nextMatch && (
          <div className="home-hero__next">
            <span>
              <strong>Next:</strong> {nextMatch.fixture}
              {nextMatch.date ? ` · ${nextMatch.date}` : ""}
              {nextMatch.venue ? ` · ${nextMatch.venue}` : ""}
            </span>
            <Link href="/match" className="home-hero__cta">
              Pick teams
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
