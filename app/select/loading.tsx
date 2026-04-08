/** Shown while `/select` RSC loads. */
export default function SelectLoading() {
  return (
    <main className="page-main" aria-busy="true">
      <div className="route-loading">
        <div className="route-loading__header">
          <div className="route-loading__line" />
          <div className="route-loading__line route-loading__line--title" />
          <div className="route-loading__line route-loading__line--sub" />
        </div>
        <div className="route-loading__hero" style={{ minHeight: 240 }} />
        <div className="route-loading__grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="route-loading__card" style={{ height: 72 }} />
          ))}
        </div>
      </div>
    </main>
  );
}
