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
    const isRateLimit = msg.toLowerCase().includes("blocked for");
    const isDailyQuota = msg.toLowerCase().includes("exceeded hits limit") || msg.toLowerCase().includes("hits today");
    const friendlyError = isRateLimit
      ? `Too many requests in a short time — the API blocked us for 15 minutes. Please wait a moment and try again. (${msg})`
      : isDailyQuota
        ? `Daily API quota reached (100 requests/day on the free plan). Try again tomorrow or upgrade at cricketdata.org. (${msg})`
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
