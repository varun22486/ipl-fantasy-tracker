/** Shown while `/match/[id]` RSC loads (Supabase + lineup). */
export default function MatchDetailLoading() {
  return (
    <main className="page-main match-detail" aria-busy="true">
      <div className="route-loading">
        <div className="route-loading__header">
          <div className="route-loading__line" />
          <div className="route-loading__line route-loading__line--title" />
          <div className="route-loading__line route-loading__line--sub" />
        </div>
        <div className="route-loading__hero" />
        <div className="route-loading__grid">
          <div className="route-loading__card" />
          <div className="route-loading__card" />
          <div className="route-loading__card" />
          <div className="route-loading__card" />
        </div>
        <div className="detail-panel-skeleton" style={{ marginTop: 0 }} />
        <div className="detail-panel-skeleton" />
      </div>
    </main>
  );
}
