import Link from "next/link";

const ACCENT = ["#facc15", "#94a3b8", "#fb923c", "#60a5fa", "#f87171", "#4ade80", "#c084fc", "#22d3ee"];

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
        <p className="home-hero__eyebrow">League table · multi-player</p>
        <div className="standings-hero__title-row">
          <h2 id="series-standings-heading" className="home-hero__title standings-hero__heading">
            Series standings
          </h2>
          <span className="standings-hero__badge">
            <span className="standings-hero__badge-dot" aria-hidden />
            {participants.length} {participants.length === 1 ? "player" : "players"}
          </span>
        </div>
        <p className="standings-hero__subtitle">
          Season-long fantasy points, head-to-head wins, and win rate — climb the board every match night.
        </p>

        <ol className="standings-hero__list">
          {participants.map((p, i) => {
            const pct = Math.min(100, (p.totalPoints / maxPts) * 100);
            const barColor = ACCENT[i % ACCENT.length];
            const winPct = p.matches > 0 ? Math.round((p.wins / p.matches) * 100) : null;
            const behind = i > 0 ? Math.max(0, lead - p.totalPoints) : 0;
            const rankClass =
              i === 0
                ? "standings-hero__row--gold"
                : i === 1
                  ? "standings-hero__row--silver"
                  : i === 2
                    ? "standings-hero__row--bronze"
                    : "standings-hero__row--rest";

            return (
              <li key={`${i}-${p.name}`} className={`standings-hero__row ${rankClass}`}>
                <div className="standings-hero__rank" aria-label={`Rank ${i + 1}`}>
                  {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : <span className="standings-hero__rank-num">{i + 1}</span>}
                </div>
                <div className="standings-hero__avatar" style={{ borderColor: barColor, color: barColor }} aria-hidden>
                  <span className="standings-hero__avatar-inner">{initials(p.name)}</span>
                </div>
                <div className="standings-hero__body">
                  <div className="standings-hero__name-row">
                    <span className="standings-hero__name">{p.name}</span>
                    {behind > 0 && (
                      <span className="standings-hero__gap" title="Points behind leader">
                        −{behind} <span className="standings-hero__gap-label">pts</span>
                      </span>
                    )}
                  </div>
                  <div className="standings-hero__track" role="presentation">
                    <div
                      className="standings-hero__track-fill"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${barColor}, ${barColor}cc)`,
                      }}
                    />
                  </div>
                </div>
                <div className="standings-hero__stats">
                  <div className="standings-hero__pts-block">
                    <span className="standings-hero__pts">{p.totalPoints.toLocaleString()}</span>
                    <span className="standings-hero__pts-suffix">pts</span>
                  </div>
                  <div className="standings-hero__chips">
                    <span className="standings-hero__chip standings-hero__chip--wins">
                      {p.wins} {p.wins === 1 ? "win" : "wins"}
                    </span>
                    <span className="standings-hero__chip">{p.matches} {p.matches === 1 ? "match" : "matches"}</span>
                    {winPct != null && p.matches > 0 && (
                      <span className="standings-hero__chip standings-hero__chip--rate">{winPct}% win rate</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

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
