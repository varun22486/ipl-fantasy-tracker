import Link from "next/link";

const MONO_BG = ["#1e3a5f", "#312e81", "#134e4a", "#713f12", "#831843", "#164e63", "#4c1d95", "#14532d"];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

type Participant = { name: string; totalPoints: number; wins: number; matches: number };

function tierClass(i: number) {
  if (i === 0) return "standings-panel__row--t1";
  if (i === 1) return "standings-panel__row--t2";
  if (i === 2) return "standings-panel__row--t3";
  return "";
}

export default function SeriesStandingsHero({
  participants,
  nextMatch,
}: {
  participants: Participant[];
  nextMatch: { fixture: string; date: string; venue: string | null } | null;
}) {
  const lead = participants[0]?.totalPoints ?? 0;

  return (
    <section className="home-hero home-hero--standings standings-panel" aria-labelledby="league-table-heading">
      <div className="home-hero__inner">
        <header className="standings-panel__intro">
          <p className="standings-panel__kicker">Season leaderboard</p>
          <h2 id="league-table-heading" className="standings-panel__title">
            League table
          </h2>
          <p className="standings-panel__lead">
            {participants.length} {participants.length === 1 ? "player" : "players"} · ranked by fantasy points
          </p>
        </header>

        <div className="standings-panel__sheet">
          <div className="standings-panel__thead" aria-hidden="true">
            <span className="standings-panel__th standings-panel__th--pos">#</span>
            <span className="standings-panel__th standings-panel__th--player">Player</span>
            <span className="standings-panel__th standings-panel__th--pts">Pts</span>
            <span className="standings-panel__th standings-panel__th--rec">Record</span>
          </div>
          <ol className="standings-panel__tbody">
            {participants.map((p, i) => {
              const behind = i > 0 ? Math.max(0, lead - p.totalPoints) : 0;
              const losses = Math.max(0, p.matches - p.wins);
              const winPct = p.matches > 0 ? Math.round((p.wins / p.matches) * 100) : null;
              const record =
                p.matches > 0
                  ? `${p.wins}–${losses}${winPct != null ? ` · ${winPct}%` : ""}`
                  : "—";
              const bg = MONO_BG[i % MONO_BG.length];
              const label = `${i + 1}. ${p.name}, ${p.totalPoints.toLocaleString()} points, ${record}`;

              return (
                <li
                  key={`${i}-${p.name}`}
                  className={`standings-panel__row ${tierClass(i)}`}
                  aria-label={label}
                >
                  <span className="standings-panel__pos">
                    <span className="standings-panel__pos-inner">{i + 1}</span>
                  </span>
                  <div className="standings-panel__player">
                    <span
                      className="standings-panel__mono"
                      style={{ background: bg }}
                      aria-hidden="true"
                    >
                      {initials(p.name)}
                    </span>
                    <div className="standings-panel__name-block">
                      <span className="standings-panel__name">{p.name}</span>
                      {behind > 0 ? (
                        <span className="standings-panel__gb" title="Points behind leader">
                          −{behind} pts behind
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <span className="standings-panel__pts">{p.totalPoints.toLocaleString()}</span>
                  <span className="standings-panel__record">{record}</span>
                </li>
              );
            })}
          </ol>
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
