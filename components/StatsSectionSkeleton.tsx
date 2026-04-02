/** Loading shell while chart-heavy stats client chunk loads (code-split). */
export default function StatsSectionSkeleton({ variant }: { variant: "duo" | "multi" }) {
  const n = variant === "multi" ? 5 : 4;
  return (
    <section className="stats-skeleton" aria-busy="true" aria-label="Loading analytics">
      <div className="stats-skeleton__header">
        <span className="stats-skeleton__line stats-skeleton__line--title" />
        <span className="stats-skeleton__line stats-skeleton__line--sub" />
      </div>
      <div className="stats-skeleton__grid">
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="stats-skeleton__card" />
        ))}
      </div>
      <div className="stats-skeleton__chart" />
      <div className="stats-skeleton__chart stats-skeleton__chart--short" />
      <p className="stats-skeleton__hint">Loading charts & insights…</p>
    </section>
  );
}
