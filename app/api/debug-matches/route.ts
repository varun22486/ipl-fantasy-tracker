import { NextResponse } from "next/server";

// Calls the cricket API directly and returns raw match data so you can
// see exactly what the feed is sending — useful when IPL filtering fails.
// Access at: /api/debug-matches
export async function GET() {
  const baseUrl = (process.env.CRICKET_API_BASE_URL || "https://api.cricapi.com").replace(/\/$/, "");
  const key1 = (process.env.CRICKET_API_KEY || "").trim();
  const key2 = (process.env.CRICKET_API_KEY_2 || "").trim();
  const apiKey = key1 || key2;

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "No CRICKET_API_KEY set" }, { status: 500 });
  }

  async function fetchRaw(path: string) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${baseUrl}${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 0 } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return res.json();
  }

  try {
    const [current, recent] = await Promise.allSettled([
      fetchRaw("/v1/currentMatches?offset=0"),
      fetchRaw("/v1/recentMatches?offset=0"),
    ]);

    const currentData = current.status === "fulfilled" ? current.value : { error: (current as any).reason?.message };
    const recentData = recent.status === "fulfilled" ? recent.value : { error: (recent as any).reason?.message };

    // Extract match arrays
    const currentMatches: any[] = currentData?.data ?? currentData?.matches ?? [];
    const recentMatches: any[] = recentData?.data ?? recentData?.matches ?? [];

    // Return a compact summary of each match so it's easy to scan
    function summarize(m: any) {
      return {
        id: m.id,
        name: m.name,
        title: m.title,
        matchDesc: m.matchDesc,
        series: m.series,
        seriesName: m.seriesName,
        matchType: m.matchType,
        type: m.type,
        status: m.status,
        venue: m.venue,
        teams: m.teams,
        teamInfo: m.teamInfo,
        date: m.date,
        dateTimeGMT: m.dateTimeGMT,
      };
    }

    return NextResponse.json({
      ok: true,
      currentMatchCount: currentMatches.length,
      recentMatchCount: recentMatches.length,
      currentStatus: currentData?.status,
      recentStatus: recentData?.status,
      currentMatches: currentMatches.map(summarize),
      recentMatches: recentMatches.slice(0, 10).map(summarize),
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message }, { status: 500 });
  }
}
