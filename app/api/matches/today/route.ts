import { NextResponse } from "next/server";
import { getIplMatchChoicesForToday } from "@/lib/cricket-provider";

export async function GET() {
  try {
    const { choices, totalRaw, nonIplSample } = await getIplMatchChoicesForToday();

    const date = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date());

    return NextResponse.json({ ok: true, choices, totalRaw, nonIplSample, date });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not load matches";
    const lower = msg.toLowerCase();
    const isRateLimit = lower.includes("blocked for") || lower.includes("blocking");
    const isDailyQuota =
      lower.includes("exceeded hits limit") ||
      lower.includes("hits today") ||
      lower.includes("all keys failed") ||
      lower.includes("quota");
    const friendlyError = isRateLimit
      ? "Rate-limited for 15 minutes — too many requests in a short window. Wait a moment and try again."
      : isDailyQuota
        ? "Both API keys have hit today's quota (100 req/day each). Quota resets at midnight UTC. Try again later or check cricketdata.org."
        : msg;
    return NextResponse.json(
      {
        ok: false,
        error: friendlyError,
      },
      { status: 500 }
    );
  }
}
