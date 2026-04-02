import { NextResponse } from "next/server";

// Diagnostic endpoint — returns raw API data so you can see exactly what
// the feed is sending and which keys are working.
// Access at: /api/debug-matches
export async function GET() {
  const baseUrl = (process.env.CRICKET_API_BASE_URL || "https://api.cricapi.com").replace(/\/$/, "");

  const keys = [
    (process.env.CRICKET_API_KEY || "").trim(),
    (process.env.CRICKET_API_KEY_2 || "").trim(),
    (process.env.CRICKET_API_KEY_3 || "").trim(),
    (process.env.CRICKET_API_KEY_4 || "").trim(),
    (process.env.CRICKET_API_KEY_5 || "").trim(),
    (process.env.CRICKET_API_KEY_6 || "").trim(),
    (process.env.CRICKET_API_KEY_7 || "").trim(),
    (process.env.CRICKET_API_KEY_8 || "").trim(),
    (process.env.CRICKET_API_KEY_9 || "").trim(),
    (process.env.CRICKET_API_KEY_10 || "").trim(),
  ].filter(Boolean);

  if (keys.length === 0) {
    return NextResponse.json({ ok: false, error: "No CRICKET_API_KEY set" }, { status: 500 });
  }

  // Use the first working key
  const apiKey = keys[0];

  async function fetchRaw(path: string, key = apiKey) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${baseUrl}${path}${sep}apikey=${encodeURIComponent(key)}`;
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) return { httpError: res.status, url };
      const json = await res.json();
      return { url, ...json };
    } catch (e: any) {
      return { fetchError: e?.message, url };
    }
  }

  // Test each key sequentially — parallel calls were tripping per-key rate limits instantly.
  const keyTests: { keyAlias: string; status?: string; matchCount: number | string; reason?: string }[] = [];
  for (const k of keys) {
    const res = await fetchRaw("/v1/currentMatches?offset=0", k);
    const count = Array.isArray(res?.data) ? res.data.length : "?";
    keyTests.push({
      keyAlias: k.slice(0, 8) + "...",
      status: res?.status,
      matchCount: count,
      reason: res?.reason,
    });
  }

  // Current matches with first working key
  const currentRaw = await fetchRaw("/v1/currentMatches?offset=0");
  const currentMatches: any[] = currentRaw?.data ?? [];

  // Recent matches
  const recentRaw = await fetchRaw("/v1/recentMatches?offset=0");
  const recentMatches: any[] = recentRaw?.data ?? [];

  // Series search for IPL
  const seriesRaw = await fetchRaw("/v1/series?offset=0");
  const allSeries: any[] = seriesRaw?.data ?? [];
  const iplSeries = allSeries.filter((s: any) => {
    const n = String(s.name || s.title || "").toLowerCase();
    return n.includes("ipl") || n.includes("indian premier");
  });

  // Test the hardcoded series ID
  const knownSeriesId = "87c62aac-bc3c-4738-ab93-19da0690488f";
  const envSeriesId = (process.env.CRICKET_IPL_SERIES_ID || "").trim();
  const seriesIdToTest = envSeriesId || knownSeriesId;
  const seriesInfoRaw = await fetchRaw(`/v1/series_info?id=${encodeURIComponent(seriesIdToTest)}`);
  const matchList: any[] = seriesInfoRaw?.data?.matchList ?? [];

  function summarize(m: any) {
    return {
      id: m.id,
      name: m.name,
      date: m.date,
      dateTimeGMT: m.dateTimeGMT,
      status: m.status,
      venue: m.venue?.replace(/,.*$/, ""),
    };
  }

  return NextResponse.json({
    ok: true,
    keyTests,
    seriesIdTested: seriesIdToTest,
    iplSeriesInFeed: iplSeries.map((s: any) => ({ id: s.id, name: s.name })),
    seriesMatchListCount: matchList.length,
    seriesMatchListSample: matchList.slice(0, 5).map(summarize),
    currentMatchCount: currentMatches.length,
    recentMatchCount: recentMatches.length,
    currentSample: currentMatches.slice(0, 5).map(summarize),
    recentSample: recentMatches.slice(0, 5).map(summarize),
  });
}
