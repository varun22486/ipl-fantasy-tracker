import { NextRequest, NextResponse } from "next/server";

/**
 * Debug endpoint: shows the raw API response for a match's scorecard, squad, and info.
 * Usage: GET /api/debug-roster?id=MATCH_UUID
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "Pass ?id=MATCH_UUID" }, { status: 400 });
  }

  const baseUrl = (process.env.CRICKET_API_BASE_URL || "https://api.cricapi.com").replace(/\/$/, "");
  const keys = [
    process.env.CRICKET_API_KEY,
    process.env.CRICKET_API_KEY_2,
    process.env.CRICKET_API_KEY_3,
    process.env.CRICKET_API_KEY_4,
    process.env.CRICKET_API_KEY_5,
  ].filter(Boolean) as string[];
  const apiKey = keys[0] || "";

  async function fetchRaw(path: string) {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${baseUrl}${path}${sep}apikey=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return { httpError: res.status };
    return res.json();
  }

  const [scorecard, squad, info] = await Promise.allSettled([
    fetchRaw(`/v1/match_scorecard?offset=0&id=${id}`),
    fetchRaw(`/v1/match_squad?id=${id}`),
    fetchRaw(`/v1/match_info?id=${id}`),
  ]);

  function unwrap(r: PromiseSettledResult<any>) {
    if (r.status === "rejected") return { error: String(r.reason) };
    const v = r.value;
    // Summarise to avoid massive responses
    const data = v?.data;
    return {
      status: v?.status,
      dataType: Array.isArray(data) ? `array[${data.length}]` : typeof data,
      topKeys: data && typeof data === "object" ? Object.keys(data).slice(0, 20) : [],
      // For arrays (match_squad), show first team
      firstItem: Array.isArray(data) ? {
        name: data[0]?.name,
        playerCount: data[0]?.players?.length,
        firstPlayer: data[0]?.players?.[0],
      } : undefined,
      // For objects (scorecard/info), show player-related keys
      playersType: data?.players ? (Array.isArray(data.players) ? `array[${data.players.length}]` : typeof data.players) : "missing",
      playersKeys: data?.players && !Array.isArray(data.players) ? Object.keys(data.players) : undefined,
      teamInfoCount: Array.isArray(data?.teamInfo) ? data.teamInfo.length : "missing",
      squadCount: Array.isArray(data?.squad) ? data.squad.length : "missing",
      battingInnings: Array.isArray(data?.batting) ? data.batting.length : "missing",
      firstBattingInning: Array.isArray(data?.batting) ? {
        title: data.batting[0]?.title,
        batsmenCount: data.batting[0]?.batsman?.length ?? data.batting[0]?.batsmen?.length,
        firstBatsman: data.batting[0]?.batsman?.[0] ?? data.batting[0]?.batsmen?.[0],
      } : undefined,
    };
  }

  return NextResponse.json({
    ok: true,
    matchId: id,
    scorecard: unwrap(scorecard),
    squad: unwrap(squad),
    matchInfo: unwrap(info),
  });
}
