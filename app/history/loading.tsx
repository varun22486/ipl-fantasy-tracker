/** Shown while `/history` RSC loads. */
export default function HistoryLoading() {
  return (
    <main className="page-main history-page" aria-busy="true">
      <div className="route-loading">
        <div className="route-loading__header">
          <div className="route-loading__line" />
          <div className="route-loading__line route-loading__line--title" />
          <div className="route-loading__line route-loading__line--sub" />
        </div>
        <div className="route-loading__grid" style={{ marginBottom: 8 }}>
          <div className="route-loading__card" />
          <div className="route-loading__card" />
          <div className="route-loading__card" />
        </div>
        <div className="route-loading__list">
          <div className="route-loading__row" />
          <div className="route-loading__row" />
          <div className="route-loading__row" />
        </div>
      </div>
    </main>
  );
}
