/** Shown while `/match` RSC loads (active match + fantasy rows). */
export default function MatchPageLoading() {
  return (
    <main className="page-main" aria-busy="true">
      <div className="route-loading">
        <div className="route-loading__header">
          <div className="route-loading__line" />
          <div className="route-loading__line route-loading__line--title" />
          <div className="route-loading__line route-loading__line--sub" />
        </div>
        <div className="route-loading__hero" style={{ minHeight: 200 }} />
        <div className="route-loading__grid">
          <div className="route-loading__card" />
          <div className="route-loading__card" />
        </div>
      </div>
    </main>
  );
}
