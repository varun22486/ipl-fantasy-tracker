import StatsSectionSkeleton from "@/components/StatsSectionSkeleton";

/** Shown while the home RSC loads (e.g. switching competition `?c=`). */
export default function HomeLoading() {
  return (
    <main className="page-main" aria-busy="true">
      <section
        className="home-hero"
        style={{ marginBottom: 28, minHeight: 220, opacity: 0.92 }}
        aria-hidden
      >
        <div className="home-hero__inner" style={{ padding: "32px 36px 36px" }}>
          <div
            style={{
              height: 12,
              width: 140,
              borderRadius: 6,
              background: "rgba(255,255,255,0.12)",
              marginBottom: 16,
            }}
          />
          <div
            style={{
              height: 36,
              maxWidth: 420,
              borderRadius: 8,
              background: "rgba(255,255,255,0.14)",
              marginBottom: 12,
            }}
          />
          <div
            style={{
              height: 16,
              maxWidth: 320,
              borderRadius: 6,
              background: "rgba(255,255,255,0.08)",
            }}
          />
        </div>
      </section>
      <StatsSectionSkeleton variant="duo" />
    </main>
  );
}
