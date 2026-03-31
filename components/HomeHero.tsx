import Link from "next/link";

type Summary = {
  yourWins: number;
  oppWins: number;
  ties: number;
  yourTotal: number;
  oppTotal: number;
  matchesPlayed: number;
};

type NextMatch = { fixture: string; date: string; venue: string | null } | null;

export default function HomeHero({
  yourName,
  opponentName,
  summary,
  nextMatch,
}: {
  yourName: string;
  opponentName: string;
  summary: Summary;
  nextMatch: NextMatch;
}) {
  return (
    <section className="home-hero" aria-labelledby="home-hero-heading">
      <div className="home-hero__inner">
        <p className="home-hero__eyebrow">IPL fantasy · head-to-head</p>
        <h2 id="home-hero-heading" className="home-hero__title">
          Welcome back
        </h2>
        <p className="home-hero__lead">
          Tracking <strong style={{ color: "#93c5fd" }}>{yourName}</strong> vs <strong style={{ color: "#fca5a5" }}>{opponentName}</strong> — match-by-match results, cumulative points, and season insights.
        </p>
        <div className="home-hero__stats">
          <div className="home-hero__stat">
            <div className="home-hero__stat-label">Your wins</div>
            <div className="home-hero__stat-value home-hero__stat-value--you">{summary.yourWins}</div>
          </div>
          <div className="home-hero__stat">
            <div className="home-hero__stat-label">{opponentName} wins</div>
            <div className="home-hero__stat-value home-hero__stat-value--opp">{summary.oppWins}</div>
          </div>
          <div className="home-hero__stat">
            <div className="home-hero__stat-label">Ties</div>
            <div className="home-hero__stat-value">{summary.ties}</div>
          </div>
          <div className="home-hero__stat">
            <div className="home-hero__stat-label">Matches with data</div>
            <div className="home-hero__stat-value">{summary.matchesPlayed}</div>
          </div>
          <div className="home-hero__stat">
            <div className="home-hero__stat-label">Your series pts</div>
            <div className="home-hero__stat-value home-hero__stat-value--you">{summary.yourTotal}</div>
          </div>
          <div className="home-hero__stat">
            <div className="home-hero__stat-label">{opponentName} series pts</div>
            <div className="home-hero__stat-value home-hero__stat-value--opp">{summary.oppTotal}</div>
          </div>
        </div>
        {nextMatch && (
          <div className="home-hero__next" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16 }}>
            <span>
              <strong>Next on the calendar:</strong> {nextMatch.fixture}
              {nextMatch.date ? ` · ${nextMatch.date}` : ""}
              {nextMatch.venue ? ` · ${nextMatch.venue}` : ""}
            </span>
            <Link
              href="/select"
              style={{
                padding: "8px 16px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.95)",
                color: "#0f172a",
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Pick teams
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
